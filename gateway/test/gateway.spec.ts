import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { gatewayFetch, LimitDbD1, type Middleware, type Next } from '@pydantic/ai-gateway'
import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import type {
  DefaultProviderProxy,
  ProxyInvalidRequest,
  ProxyStreamingSuccess,
  ProxySuccess,
  ProxyUnexpectedResponse,
  ProxyWhitelistedEndpoint,
} from '../src/providers/default'
import { test } from './setup'
import { buildGatewayEnv, type DisableEvent, IDS } from './worker'

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
      `"Invalid provider 'wrong', should be one of groq, openai, google-vertex, anthropic, bedrock"`,
    )
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

    const limitDb = new LimitDbD1(env.limitsDB)

    // The scopeInterval changes every day, so we've set it to undefined for the snapshot.
    expect((await limitDb.spendStatus('key')).map((s) => ({ ...s, scopeInterval: undefined }))).toMatchSnapshot(
      'key-spends',
    )
    expect((await limitDb.spendStatus('user')).map((s) => ({ ...s, scopeInterval: undefined }))).toMatchSnapshot(
      'user-spends',
    )
    expect((await limitDb.spendStatus('project')).map((s) => ({ ...s, scopeInterval: undefined }))).toMatchSnapshot(
      'project-spends',
    )

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
        "entityId": 3,
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
        "entityId": 3,
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

function mockFetchFactory(
  disableEvents: DisableEvent[],
): (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const ctx = createExecutionContext()

  async function mockFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(url, init as RequestInit<IncomingRequestCfProperties>)
    const url_ = new URL(url instanceof Request ? url.url : url)
    const response = await gatewayFetch(
      request,
      url_,
      ctx,
      buildGatewayEnv(env, disableEvents, fetch, '/proxy'.length),
    )
    await waitOnExecutionContext(ctx)
    return response
  }

  return mockFetch
}

describe('custom proxyPrefixLength', () => {
  it('inference', async () => {
    const disableEvents: DisableEvent[] = []
    const mockFetch = mockFetchFactory(disableEvents)

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/proxy/openai', fetch: mockFetch })

    const completion = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        { role: 'developer', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      max_completion_tokens: 1024,
    })
    expect(completion).toMatchSnapshot('proxyPrefixLength')
  })

  it('index', async () => {
    const disableEvents: DisableEvent[] = []
    const mockFetch = mockFetchFactory(disableEvents)

    const response = await mockFetch('https://example.com/proxy/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })
})

describe('custom middleware', () => {
  it('middleware', async () => {
    const responses: (
      | ProxySuccess
      | ProxyInvalidRequest
      | ProxyUnexpectedResponse
      | ProxyStreamingSuccess
      | ProxyWhitelistedEndpoint
    )[] = []

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/openai/gpt-5', {
      headers: { Authorization: 'healthy' },
    })

    class CollectMiddleware implements Middleware {
      dispatch(next: Next): Next {
        return async (proxy: DefaultProviderProxy) => {
          const response = await next(proxy)
          responses.push(response)
          return response
        }
      }
    }

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new CollectMiddleware()])
    await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    expect(responses).lengthOf(1)
  })
})
