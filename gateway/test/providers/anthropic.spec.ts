import Anthropic from '@anthropic-ai/sdk'
import { describe, expect } from 'vitest'
import { test } from '../setup'

describe('anthropic', () => {
  test('should call anthropic via gateway', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new Anthropic({
      // The `authToken` is passed as `Authorization` header with the anthropic client.
      authToken: 'healthy',
      baseURL: 'https://example.com/anthropic',
      fetch,
    })

    const completion = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      top_p: 0.95,
      top_k: 1,
      temperature: 0.5,
      stop_sequences: ['potato'],
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    })
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
