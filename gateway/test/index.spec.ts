import OpenAI from 'openai'
import Groq from 'groq-sdk'
import Anthropic from '@anthropic-ai/sdk'
import { env, createExecutionContext } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import SQL from '../limits-schema.sql?raw'

import { gatewayFetch } from '@pydantic/ai-gateway'
import { buildGatewayEnv } from './worker'

beforeAll(async () => {
  try {
    const response = await fetch('http://localhost:8005')
    expect(response.status, 'The Proxy VCR seems to be facing issues, please check the logs.').toBe(204)
  } catch {
    throw new Error('Proxy VCR is not running. Run `make run-proxy-vcr` to enable tests.')
  }
})

const RESET_SQL = `DROP TABLE IF EXISTS spend;\n${SQL}`

beforeEach(async () => {
  await env.limitsDB.prepare(RESET_SQL).run()
})

interface TestGateway {
  fetch: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  ctx: ExecutionContext
  otelBatch: string[]
}

function testGateway(): TestGateway {
  const ctx = createExecutionContext()
  const otelBatch: string[] = []

  async function subFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let hostname: string
    if (url instanceof Request) {
      hostname = new URL(url.url).hostname
    } else {
      hostname = new URL(url).hostname
    }
    if (hostname === 'logfire.pydantic.dev') {
      const bodyArray = init?.body as Uint8Array
      otelBatch.push(new TextDecoder().decode(bodyArray))
      return new Response('OK', { status: 200 })
    } else {
      return await fetch(url, init)
    }
  }

  async function mockFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request<unknown, IncomingRequestCfProperties>(
      url,
      init as RequestInit<IncomingRequestCfProperties>,
    )
    return await gatewayFetch(request, ctx, buildGatewayEnv(env, subFetch))
  }
  return { fetch: mockFetch, ctx, otelBatch }
}

describe('index', () => {
  it('responds with index html', async () => {
    const response = await testGateway().fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `
      "<h1>Pydantic AI Gateway</h1>
      <p>release: test</p>
      "
    `,
    )
  })
})

describe('invalid request', () => {
  it('401 on no auth header', async () => {
    const response = await testGateway().fetch('https://example.com/openai/gpt-5')
    const text = await response.text()
    expect(response.status, `got response: ${text}`).toBe(401)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Missing Authorization Header"`)
  })
  it('401 on unknown auth header', async () => {
    const response = await testGateway().fetch('https://example.com/openai/gpt-5', {
      headers: { Authorization: 'unknown-token' },
    })
    const text = await response.text()
    expect(response.status, `got response: ${text}`).toBe(401)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Key not found"`)
  })
  it('400 on unknown provider', async () => {
    const response = await testGateway().fetch('https://example.com/wrong/gpt-5', {
      headers: { Authorization: 'unknown-token' },
    })
    const text = await response.text()
    expect(response.status, `got response: ${text}`).toBe(400)
    expect(text).toMatchInlineSnapshot(
      `"Invalid provider 'wrong', should be one of groq, openai, google-vertex, anthropic"`,
    )
  })
})

describe('openai', () => {
  it('should call openai via gateway', async () => {
    const { fetch, otelBatch } = testGateway()

    const client = new OpenAI({
      apiKey: 'healthy',
      baseURL: 'https://example.com/openai',
      fetch,
    })

    const completion = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    })

    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch.length, 'otelBatch length not 1').toBe(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})

describe('groq', () => {
  it('should call groq via gateway', async () => {
    const { fetch } = testGateway()
    const client = new Groq({
      apiKey: 'healthy',
      baseURL: 'https://example.com/groq',
      fetch,
    })

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    })
    expect(completion).toMatchSnapshot('llm')
  })
})

describe('anthropic', () => {
  it('should call anthropic via gateway', async () => {
    const { fetch, otelBatch } = testGateway()

    const client = new Anthropic({
      // The `authToken` is passed as `Authorization` header.
      authToken: 'healthy',
      baseURL: 'https://example.com/anthropic',
      fetch,
    })

    const completion = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    })
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch.length).toBe(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
