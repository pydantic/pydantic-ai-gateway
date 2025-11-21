import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { describe, expect } from 'vitest'
import { deserializeRequest } from '../otel'
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
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
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
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
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
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })

  test('should whitelist /v1/messages/count_tokens endpoint', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new Anthropic({ authToken: 'healthy', baseURL: 'https://example.com/anthropic', fetch })

    const result = await client.beta.messages.countTokens({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    })

    expect(result).toMatchSnapshot('count_tokens')
    expect(otelBatch, 'otelBatch should be empty for whitelisted endpoint').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })

  test('should return 404 for unsupported model', async ({ gateway }) => {
    const { fetch } = gateway

    const client = new Anthropic({ authToken: 'healthy', baseURL: 'https://example.com/anthropic', fetch })

    await expect(async () => {
      await client.messages.create({
        model: 'unsupported-model-xyz',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'What is the capital of France?' }],
      })
    }).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: 404 PAIG does not support the model \`unsupported-model-xyz\` yet. We're working on it!]`,
    )
  })

  test('should call anthropic via gateway with chat completion', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/anthropic/v1', fetch })

    const completion = await client.chat.completions.create(
      { model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'What is the capital of France?' }] },
      { headers: { 'x-vcr-filename': 'anthropic-chat-completion', 'accept-encoding': 'deflate' } },
    )
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })
})
