import Anthropic from '@anthropic-ai/sdk'
import { describe, expect } from 'vitest'
import { test } from '../setup'

describe('anthropic', () => {
  test('should call anthropic via gateway', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    // The `authToken` is passed as `Authorization` header with the anthropic client.
    const client = new Anthropic({ authToken: 'healthy', baseURL: 'https://example.com/anthropic', fetch })

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

  test('should call anthropic via gateway with builtin tools', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new Anthropic({ authToken: 'healthy', baseURL: 'https://example.com/anthropic', fetch })

    const response = await client.beta.messages.create({
      model: 'claude-opus-4-1-20250805',
      betas: ['code-execution-2025-08-25'],
      max_tokens: 4096,
      messages: [
        { role: 'user', content: 'Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]' },
      ],
      tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
    })
    expect(response).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })

  test('should call anthropic via gateway with stream', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new Anthropic({ authToken: 'healthy', baseURL: 'https://example.com/anthropic', fetch })

    const stream = await client.beta.messages.create({
      model: 'claude-opus-4-1-20250805',
      stream: true,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    })
    const chunks: object[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    expect(chunks).toMatchSnapshot('chunks')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
