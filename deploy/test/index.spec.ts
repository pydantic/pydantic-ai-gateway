import OpenAI from 'openai'
import { SELF, env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'

// @ts-ignore
import SQL from '../limits-schema.sql?raw'

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
DROP TABLE IF EXISTS namespaces;
DROP TABLE IF EXISTS kv;

${SQL}
`,
      )
      .run()
  })

  it('should call openai via gateway', async () => {
    const client = new OpenAI({
      apiKey: 'o-QBrunFudqD99879C5jkFZgZrueCLlCJGSMAbzFGFY',
      baseURL: 'https://example.com/openai',
      fetch: SELF.fetch.bind(SELF),
      defaultHeaders: { 'X-VCR-FILENAME': 'openai-chat-completion.yaml' },
    })

    const completion = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    })

    expect(completion).toMatchInlineSnapshot(`
      {
        "choices": [
          {
            "finish_reason": "stop",
            "index": 0,
            "message": {
              "annotations": [],
              "content": "Paris.",
              "refusal": null,
              "role": "assistant",
            },
          },
        ],
        "created": 1757186985,
        "id": "chatcmpl-CCstVpoEahHH9q0YclOQCy0a0ciKS",
        "model": "gpt-5-2025-08-07",
        "object": "chat.completion",
        "service_tier": "default",
        "system_fingerprint": null,
        "usage": {
          "completion_tokens": 11,
          "completion_tokens_details": {
            "accepted_prediction_tokens": 0,
            "audio_tokens": 0,
            "reasoning_tokens": 0,
            "rejected_prediction_tokens": 0,
          },
          "prompt_tokens": 23,
          "prompt_tokens_details": {
            "audio_tokens": 0,
            "cached_tokens": 0,
          },
          "pydantic_ai_gateway": {
            "cost_estimate": 0.00013875,
          },
          "total_tokens": 34,
        },
      }
    `)
  })
})
