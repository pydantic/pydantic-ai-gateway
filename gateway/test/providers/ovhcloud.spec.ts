import OpenAI from 'openai'
import { describe, expect } from 'vitest'
import { deserializeRequest } from '../otel'
import { test } from '../setup'

describe('ovhcloud', () => {
  test('should call ovhcloud via gateway', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway
    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/ovhcloud', fetch })

    const completion = await client.chat.completions.create({
      model: 'gpt-oss-120b',
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

  test('ovhcloud chat stream', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/ovhcloud', fetch })

    const stream = await client.chat.completions.create({
      stream: true,
      model: 'gpt-oss-120b',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      max_completion_tokens: 1024,
    })
    const chunks: object[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    expect(chunks).toMatchSnapshot('chunks')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })
})
