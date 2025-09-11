import OpenAI from 'openai'
import Groq from 'groq-sdk'
import Anthropic from '@anthropic-ai/sdk'
import { SELF, env, fetchMock } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest'
import SQL from '../limits-schema.sql?raw'

beforeAll(async () => {
  try {
    const response = await fetch('http://localhost:8005')
    expect(response.status, 'The Proxy VCR seems to be facing issues, please check the logs.').toBe(204)
  } catch {
    throw new Error('Proxy VCR is not running. Run `make run-proxy-vcr` to enable tests.')
  }
})

const RESET_SQL = `
DROP TABLE IF EXISTS spend;
DROP TABLE IF EXISTS keyStatus;

${SQL}
`

beforeEach(async () => {
  const keys = await env.KV.list()
  if (keys.keys.length !== 0) {
    throw new Error('KV store is not empty before test.')
  }
  await env.limitsDB.prepare(RESET_SQL).run()
  fetchMock.activate()
})
afterEach(() => fetchMock.assertNoPendingInterceptors())

function recordOtelBatch(otelBatch: Array<any>) {
  fetchMock
    .get('https://logfire.pydantic.dev')
    .intercept({ method: 'POST', path: '/v1/traces', headers: { Authorization: 'write-token' } })
    .reply(({ body }) => {
      otelBatch.push(body)
      return { statusCode: 200, body }
    })
}

describe('index', () => {
  it('responds with index html', async () => {
    const response = await SELF.fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `
      "<h1>Pydantic AI Gateway</h1>
      <p>release: unknown</p>
      "
    `,
    )
  })
})

describe('invalid request', () => {
  it('401 on no auth header', async () => {
    const response = await SELF.fetch('https://example.com/openai/gpt-5')
    const text = await response.text()
    expect(response.status, `got response: ${text}`).toBe(401)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Missing Authorization Header"`)
  })
  it('401 on unknown auth header', async () => {
    const response = await SELF.fetch('https://example.com/openai/gpt-5', {
      headers: { Authorization: 'unknown-token' },
    })
    const text = await response.text()
    expect(response.status, `got response: ${text}`).toBe(401)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Key not found"`)
  })
  it('400 on unknown provider', async () => {
    const response = await SELF.fetch('https://example.com/wrong/gpt-5', {
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
    let otelBatch: Array<any> = []
    recordOtelBatch(otelBatch)

    const client = new OpenAI({
      apiKey: 'healthy-key',
      baseURL: 'https://example.com/openai',
      fetch: SELF.fetch.bind(SELF),
    })

    const completion = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    })

    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch.length).toBe(1)
    expect(JSON.parse(otelBatch[0]).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})

describe('blocked key', () => {
  it('should block key if limit is exceeded', async () => {
    const client = new OpenAI({
      apiKey: 'low-limit-key',
      baseURL: 'https://example.com/openai',
      fetch: SELF.fetch.bind(SELF),
    })

    await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Give me an essay on the history of the universe.' },
      ],
    })
    const allSpends = await env.limitsDB.prepare('SELECT * FROM spend').all()
    console.log(allSpends)
    const allKeyStatus = await env.limitsDB.prepare('SELECT * FROM keyStatus').all()
    console.log(allKeyStatus)
  })
})

describe('groq', () => {
  it('should call groq via gateway', async () => {
    const client = new Groq({
      apiKey: 'healthy-key',
      baseURL: 'https://example.com/groq',
      fetch: SELF.fetch.bind(SELF),
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
    let otelBatch: Array<any> = []
    recordOtelBatch(otelBatch)

    const client = new Anthropic({
      // The `authToken` is passed as `Authorization` header.
      authToken: 'healthy-key',
      baseURL: 'https://example.com/anthropic',
      fetch: SELF.fetch.bind(SELF),
    })

    const completion = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    })
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch.length).toBe(1)
    expect(JSON.parse(otelBatch[0]).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
