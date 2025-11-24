import OpenAI from 'openai'
import { describe, expect } from 'vitest'
import { deserializeRequest } from '../otel'
import { test } from '../setup'

describe('azure', () => {
  test('chat', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/azure', fetch })

    const completion = await client.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      max_completion_tokens: 1024,
    })

    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })

  test('responses', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/azure', fetch })

    const completion = await client.responses.create({
      model: 'gpt-4.1',
      instructions: 'reply concisely',
      input: 'what color is the sky?',
    })
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })
})
