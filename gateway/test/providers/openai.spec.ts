import { LimitDbD1 } from '@pydantic/ai-gateway'
import { env } from 'cloudflare:test'
import OpenAI from 'openai'
import { describe, expect } from 'vitest'
import { test } from '../setup'
import { IDS } from '../worker'

describe('openai', () => {
  test('should call openai via gateway', async ({ gateway }) => {
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
    const teamStatus = await limitDb.spendStatus('team')
    expect(teamStatus).toEqual([
      { entityId: IDS.teamDefault, limit: 4, scope: 'monthly', scopeInterval: expect.any(Date), spend: 0.00013875 },
    ])
    const userStatus = await limitDb.spendStatus('user')
    expect(userStatus).toEqual([
      { entityId: IDS.userDefault, limit: 3, scope: 'weekly', scopeInterval: expect.any(Date), spend: 0.00013875 },
    ])
    const keyStatus = await limitDb.spendStatus('key')
    expect(keyStatus.sort((a, b) => a.limit - b.limit)).toEqual([
      { entityId: IDS.keyHealthy, limit: 1, scope: 'daily', scopeInterval: expect.any(Date), spend: 0.00013875 },
      { entityId: IDS.keyHealthy, limit: 2, scope: 'total', scopeInterval: null, spend: 0.00013875 },
    ])
  })
})
