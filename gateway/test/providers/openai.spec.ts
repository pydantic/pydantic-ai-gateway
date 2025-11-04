import { env } from 'cloudflare:test'
import { LimitDbD1 } from '@pydantic/ai-gateway'
import OpenAI from 'openai'
import { describe, expect } from 'vitest'
import { test } from '../setup'
import { IDS } from '../worker'

describe('openai', () => {
  test('openai chat', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/openai', fetch })

    const completion = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      max_completion_tokens: 1024,
    })

    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')

    const limitDb = new LimitDbD1(env.limitsDB)
    const projectStatus = await limitDb.spendStatus('project')
    expect(projectStatus).toEqual([
      {
        entityId: IDS.projectDefault,
        limit: null,
        scope: 'daily',
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      {
        entityId: IDS.projectDefault,
        limit: null,
        scope: 'weekly',
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      {
        entityId: IDS.projectDefault,
        limit: 4,
        scope: 'monthly',
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
    ])
    const userStatus = await limitDb.spendStatus('user')
    expect(userStatus).toEqual([
      {
        entityId: IDS.userDefault,
        limit: null,
        scope: 'daily',
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      {
        entityId: IDS.userDefault,
        limit: 3,
        scope: 'weekly',
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      {
        entityId: IDS.userDefault,
        limit: null,
        scope: 'monthly',
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
    ])
    const keyStatus = await limitDb.spendStatus('key')
    expect(keyStatus.sort((a, b) => (a.limit ?? 0) - (b.limit ?? 0))).toEqual([
      {
        entityId: 4,
        scope: 'weekly',
        limit: null,
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      {
        entityId: 4,
        scope: 'monthly',
        limit: null,
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      {
        entityId: 4,
        scope: 'daily',
        limit: 1,
        scopeInterval: { date: expect.any(Date), raw: expect.any(Number) },
        spend: 0.00013875,
      },
      { entityId: 4, scope: 'total', limit: 2, scopeInterval: null, spend: 0.00013875 },
    ])
  })

  test('openai responses', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/openai', fetch })

    const completion = await client.responses.create({
      model: 'gpt-5',
      instructions: 'reply concisely',
      input: 'what color is the sky?',
    })
    expect(completion).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })

  test('openai responses with builtin tools', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/openai', fetch })

    const completion = await client.responses.create({
      model: 'gpt-5',
      instructions: 'be precise',
      input: "what's the root square of 123902139123?",
      tools: [{ type: 'code_interpreter', container: { type: 'auto' } }],
    })
    expect(completion).toMatchSnapshot('llm')
    expect(completion.usage).toMatchInlineSnapshot(`
      {
        "input_tokens": 1808,
        "input_tokens_details": {
          "cached_tokens": 0,
        },
        "output_tokens": 1061,
        "output_tokens_details": {
          "reasoning_tokens": 1024,
        },
        "pydantic_ai_gateway": {
          "cost_estimate": 0.01287,
        },
        "total_tokens": 2869,
      }
    `)
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })

  test('openai chat stream', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/openai', fetch })

    const stream = await client.chat.completions.create({
      stream: true,
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      max_completion_tokens: 1024,
      stream_options: { include_usage: true },
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
