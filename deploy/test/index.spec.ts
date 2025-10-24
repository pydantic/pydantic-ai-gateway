import { env, fetchMock, SELF } from 'cloudflare:test'
import OpenAI from 'openai'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import SQL from '../../gateway/limits-schema.sql?raw'

beforeAll(async () => {
  try {
    const response = await fetch('http://localhost:8005')
    expect(response.status, 'The Proxy VCR seems to be facing issues, please check the logs.').toBe(204)
  } catch {
    throw new Error('Proxy VCR is not running. Run `make run-proxy-vcr` to enable tests.')
  }
})

const RESET_SQL = `\
DROP TABLE IF EXISTS spend;
DROP TABLE IF EXISTS keyStatus;

${SQL}`

beforeEach(async () => {
  const keys = await env.KV.list()
  if (keys.keys.length !== 0) {
    throw new Error('KV store is not empty before test.')
  }
  await env.limitsDB.prepare(RESET_SQL).run()
  fetchMock.activate()
})
afterEach(() => {
  fetchMock.assertNoPendingInterceptors()
})

describe('index', () => {
  it('responds with index html', async () => {
    const response = await SELF.fetch('https://example.com')
    expect(response.status).toBe(200)
  })
})

function recordOtelBatch(otelBatch: string[]) {
  fetchMock
    .get('https://logfire.pydantic.dev')
    .intercept({ method: 'POST', path: '/v1/traces', headers: { Authorization: 'write-token' } })
    .reply(({ body }) => {
      if (typeof body === 'string') {
        otelBatch.push(body)
      } else {
        throw new Error('Unexpected response body type')
      }
      return { statusCode: 200, body }
    })
}

describe('deploy', () => {
  it('status auth works', async () => {
    const noAuth = await SELF.fetch('https://example.com/status/')
    expect(noAuth.status).toBe(401)
    expect(await noAuth.text()).toMatchInlineSnapshot(`"Unauthorized - Missing "Authorization" Header"`)

    const wrongAuth = await SELF.fetch('https://example.com/status/', { headers: { authorization: 'wrong' } })
    expect(wrongAuth.status).toBe(401)
    expect(await wrongAuth.text()).toMatchInlineSnapshot(`"Unauthorized - Invalid API Key"`)

    const ok = await SELF.fetch('https://example.com/status/', { headers: { authorization: 'testing' } })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toMatchSnapshot('status-empty')
  })

  it('should call openai via gateway', async () => {
    const otelBatch: string[] = []
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
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')

    const response = await SELF.fetch('https://example.com/status/', { headers: { authorization: 'testing' } })
    expect(response.status).toBe(200)
    let data = await response.text()
    data = data
      .replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD')
      .replace(/"raw": ?\d+/g, '"raw": 123456')
      .trim()
    expect(data).toMatchSnapshot('status-after-requests')
  })
})
