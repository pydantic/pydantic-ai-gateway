import OpenAI from 'openai'
import Groq from 'groq-sdk'
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'
import { test } from './conftest'

import { LimitDbD1 } from '@pydantic/ai-gateway'
import { IDS } from './worker'

describe('index', () => {
  test('responds with index html', async ({ gateway }) => {
    const response = await gateway.fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `
      "▗▄▄▖  ▗▄▖ ▗▄▄▄▖ ▗▄▄▖
      ▐▌ ▐▌▐▌ ▐▌  █  ▐▌
      ▐▛▀▘ ▐▛▀▜▌  █  ▐▌▝▜▌
      ▐▌   ▐▌ ▐▌▗▄█▄▖▝▚▄▞▘

      Pydantic AI Gateway

      git sha: test
      GitHub: https://github.com/pydantic/pydantic-ai-gateway
      To connect, point your application at https://example.com/<provider-id>
      "
    `,
    )
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })
})

describe('invalid request', () => {
  test('401 on no auth header', async ({ gateway }) => {
    const response = await gateway.fetch('https://example.com/openai/gpt-5')
    const text = await response.text()
    expect(response.status, `got ${response.status} response: ${text}`).toBe(401)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Missing Authorization Header"`)
  })
  test('401 on unknown auth header', async ({ gateway }) => {
    const response = await gateway.fetch('https://example.com/openai/gpt-5', {
      headers: { Authorization: 'unknown-token' },
    })
    const text = await response.text()
    expect(response.status, `got ${response.status} response: ${text}`).toBe(401)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Key not found"`)
  })
  test('400 on unknown provider', async ({ gateway }) => {
    const response = await gateway.fetch('https://example.com/wrong/gpt-5', {
      headers: { Authorization: 'unknown-token' },
    })
    const text = await response.text()
    expect(response.status, `got ${response.status} response: ${text}`).toBe(400)
    expect(text).toMatchInlineSnapshot(
      `"Invalid provider 'wrong', should be one of groq, openai, google-vertex, anthropic"`,
    )
  })
})

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

describe('groq', () => {
  test('should call groq via gateway', async ({ gateway }) => {
    const { fetch } = gateway
    const client = new Groq({ apiKey: 'healthy', baseURL: 'https://example.com/groq', fetch })

    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    })
    expect(completion).toMatchSnapshot('llm')
  })
})

describe('key status', () => {
  test('should not change key status if limit is not exceeded', async ({ gateway }) => {
    const { fetch } = gateway
    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })
    await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Give me an essay on the history of the universe.' },
      ],
    })
    const allSpends = await env.limitsDB
      .prepare(
        `SELECT entityId, entityType, scope, round(spend, 3) spend, spendingLimit FROM spend order by spendingLimit`,
      )
      .run<{ entityId: number; entityType: number; scope: number; spend: string; spendingLimit: number }>()
    expect(allSpends.results).toMatchSnapshot('spend-table')
    const allKeyStatus = await env.limitsDB
      .prepare('SELECT count(*) as count FROM keyStatus')
      .first<{ count: number }>()
    expect(allKeyStatus?.count).toBe(0)
  })

  test('should block request if key is disabled', async ({ gateway }) => {
    const { fetch } = gateway

    const response = await fetch('https://example.com/openai/xxx', { headers: { Authorization: 'disabled' } })
    const text = await response.text()
    expect(response.status, `got response: ${response.status} ${text}`).toBe(403)
    expect(text).toMatchInlineSnapshot(`"Unauthorized - Key disabled"`)

    const spendCount = await env.limitsDB.prepare('SELECT count(*) count FROM spend').first<{ count: number }>()
    expect(spendCount?.count).toBe(0)
    const keyStatusCount = await env.limitsDB
      .prepare('SELECT count(*) count FROM keyStatus')
      .first<{ count: number }>()
    expect(keyStatusCount?.count).toBe(0)
  })

  test('should change key status if limit is exceeded', async ({ gateway }) => {
    const { fetch, disableEvents } = gateway

    expect(disableEvents).toEqual([])

    const client = new OpenAI({ apiKey: 'tiny-limit', baseURL: 'https://example.com/test', fetch })
    await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Give me an essay on the history of the universe.' },
      ],
    })

    const apiValue = await env.KV.get('apiKeyAuth:test:tiny-limit')
    expect(apiValue).toBeTypeOf('string')
    expect(JSON.parse(apiValue!)).toMatchSnapshot('kv-value')

    const allSpends1 = await env.limitsDB
      .prepare(
        `SELECT entityId, entityType, scope, round(spend, 3) spend, spendingLimit FROM spend order by spendingLimit`,
      )
      .run<{ entityId: number; entityType: number; scope: number; spend: string; spendingLimit: number }>()
    expect(allSpends1.results).toMatchInlineSnapshot(`
          [
            {
              "entityId": 5,
              "entityType": 3,
              "scope": 1,
              "spend": 0.018,
              "spendingLimit": 0.01,
            },
            {
              "entityId": 1,
              "entityType": 1,
              "scope": 3,
              "spend": 0.018,
              "spendingLimit": 4,
            },
          ]
        `)

    expect(disableEvents).toEqual([
      {
        id: IDS.keyTinyLimit,
        reason: 'limits exceeded: key-daily',
        newStatus: 'limit-exceeded',
        expirationTtl: expect.any(Number),
      },
    ])
    expect(disableEvents[0]!.expirationTtl).toBeGreaterThanOrEqual(0)
    expect(disableEvents[0]!.expirationTtl).toBeLessThanOrEqual(86400)

    const keyStatusQuery = await env.limitsDB
      .prepare("SELECT id, status, strftime('%s', expiresAt) - strftime('%s','now') as expiresAtDiff FROM keyStatus")
      .run<{ id: string; status: string; expiresAtDiff: number }>()
    expect(keyStatusQuery.results).toEqual([
      { id: IDS.keyTinyLimit, status: 'limit-exceeded', expiresAtDiff: expect.any(Number) },
    ])
    expect(Math.abs(keyStatusQuery.results[0]!.expiresAtDiff - disableEvents[0]!.expirationTtl!)).toBeLessThan(2)

    {
      const response = await fetch('https://example.com/openai/xxx', { headers: { Authorization: 'tiny-limit' } })
      const text = await response.text()
      expect(response.status, `got ${response.status} response: ${text}`).toBe(403)
      expect(text).toMatchInlineSnapshot(`"Unauthorized - Key limit-exceeded"`)
    }

    expect(disableEvents).toEqual([
      {
        id: IDS.keyTinyLimit,
        reason: 'limits exceeded: key-daily',
        newStatus: 'limit-exceeded',
        expirationTtl: expect.any(Number),
      },
    ])
  })
})

describe('LimitDbD1', () => {
  it('updates limit', async () => {
    const db = new LimitDbD1(env.limitsDB)
    await db.incrementSpend(
      [{ entityId: IDS.userDefault, entityType: 'user', scope: 'daily', scopeInterval: 123, limit: 2 }],
      1,
    )

    {
      const state = await env.limitsDB.prepare('SELECT * FROM spend').first()
      expect(state).toMatchInlineSnapshot(`
      {
        "entityId": 2,
        "entityType": 2,
        "scope": 1,
        "scopeInterval": 123,
        "spend": 1,
        "spendingLimit": 2,
      }
    `)
    }

    await db.updateUserLimits(IDS.userDefault, { daily: 3, weekly: 5 })

    {
      const state = await env.limitsDB.prepare('SELECT * FROM spend').first()
      expect(state).toMatchInlineSnapshot(`
      {
        "entityId": 2,
        "entityType": 2,
        "scope": 1,
        "scopeInterval": 123,
        "spend": 1,
        "spendingLimit": 3,
      }
    `)
    }
  })
})
