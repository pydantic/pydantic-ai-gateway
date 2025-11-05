import Groq from 'groq-sdk'
import { describe, expect } from 'vitest'
import { deserializeRequest } from '../otel'
import { test } from '../setup'

describe('groq', () => {
  test('should call groq via gateway', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway
    const client = new Groq({ apiKey: 'healthy', baseURL: 'https://example.com/groq', fetch })

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      top_p: 0.95,
      temperature: 0.5,
      stop: ['potato'],
      max_completion_tokens: 1024,
    })
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })
})
