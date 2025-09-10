import OpenAI from 'openai'
import { SELF, env, fetchMock } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import SQL from '../limits-schema.sql?raw'

beforeAll(async () => {
  try {
    const response = await fetch('http://localhost:8005')
    expect(response.status, 'The Proxy VCR seems to be facing issues, please check the logs.').toBe(204)
  } catch {
    throw new Error('Proxy VCR is not running. Run `make run-proxy-vcr` to enable tests.')
  }
})

beforeEach(() => {
  fetchMock.activate()
})
afterAll(() => {
  fetchMock.assertNoPendingInterceptors()
})

function recordOtelBatch(otelBatch: Array<any>) {
  fetchMock
    .get('https://logfire.pydantic.dev')
    .intercept({ method: 'POST', path: '/v1/traces', headers: { Authorization: 'write-token' } })
    .reply(({ body }) => {
      otelBatch.push(body)
      return { statusCode: 200, body }
    })
}

describe('pydantic ai gateway', () => {
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

describe('openai', () => {
  beforeAll(async () => {
    await env.limitsDB
      .prepare(
        `
DROP TABLE IF EXISTS spend;

${SQL}
`,
      )
      .run()
  })

  it('should call openai via gateway', async () => {
    let otelBatch: Array<any> = []
    recordOtelBatch(otelBatch)

    const client = new OpenAI({
      apiKey: 'o-QBrunFudqD99879C5jkFZgZrueCLlCJGSMAbzFGFY',
      baseURL: 'https://example.com/openai-chat',
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
    expect(JSON.parse(otelBatch[0])['resourceSpans'][0]['scopeSpans'][0]['spans'][0]['attributes']).toMatchSnapshot(
      'span',
    )
  })
})
