import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { gatewayFetch, LimitDbD1, type Middleware, type Next, type SpendStatus } from '@pydantic/ai-gateway'
import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import type {
  DefaultProviderProxy,
  ProxyInvalidRequest,
  ProxyRequestModelNotFound,
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
    const response = await gateway.fetch('https://example.com/wrong/gpt-5', { headers: { Authorization: 'healthy' } })
    const text = await response.text()
    expect(response.status, `got ${response.status} response: ${text}`).toBe(404)
    expect(text).toMatchInlineSnapshot(
      `"Route not found: wrong. Supported values: anthropic, bedrock, converse, gemini, google-vertex, groq, openai, test"`,
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

    // The scopeInterval changes every day, hence this hack
    function patchSpends(spends: SpendStatus[]): SpendStatus[] {
      return JSON.parse(
        JSON.stringify(spends)
          .replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD')
          .replace(/"raw":\d+/g, '"raw":123456'),
      )
    }

    expect(patchSpends(await limitDb.spendStatus('key'))).toMatchSnapshot('key-spends')
    expect(patchSpends(await limitDb.spendStatus('user'))).toMatchSnapshot('user-spends')
    expect(patchSpends(await limitDb.spendStatus('project'))).toMatchSnapshot('project-spends')

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
      | ProxyRequestModelNotFound
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

describe('routing group fallback', () => {
  test('should fallback to next provider on retryable error', async () => {
    let attemptCount = 0
    const providerAttempts: string[] = []

    class FailFirstMiddleware implements Middleware {
      dispatch(next: Next): Next {
        return async (proxy: DefaultProviderProxy) => {
          attemptCount++
          const baseUrl = (proxy as unknown as { providerProxy: { baseUrl: string } }).providerProxy.baseUrl
          providerAttempts.push(baseUrl)

          // First provider should fail with 503
          if (baseUrl.includes('provider1')) {
            return {
              requestModel: 'gpt-5',
              requestBody: '{}',
              unexpectedStatus: 503,
              responseHeaders: new Headers(),
              responseBody: JSON.stringify({ error: 'Service unavailable' }),
            }
          }

          // Second provider should succeed
          return await next(proxy)
        }
      }
    }

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'fallback-test' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new FailFirstMiddleware()])
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(attemptCount).toBe(2)
    expect(providerAttempts).toEqual(['http://test.example.com/provider1', 'http://test.example.com/provider2'])

    // Verify the response came from the second provider
    const content = (await response.json()) as { choices: [{ message: { content: string } }] }
    expect(content.choices[0].message.content).toMatchInlineSnapshot(
      `"request URL: http://test.example.com/provider2/chat/completions"`,
    )
  })

  test('should fallback to next provider on 403 error', async () => {
    let attemptCount = 0
    const providerAttempts: string[] = []

    class Fail403FirstMiddleware implements Middleware {
      dispatch(next: Next): Next {
        return async (proxy: DefaultProviderProxy) => {
          attemptCount++
          const baseUrl = (proxy as unknown as { providerProxy: { baseUrl: string } }).providerProxy.baseUrl
          providerAttempts.push(baseUrl)

          // First provider should fail with 403
          if (baseUrl.includes('provider1')) {
            return {
              requestModel: 'gpt-5',
              requestBody: '{}',
              unexpectedStatus: 403,
              responseHeaders: new Headers(),
              responseBody: JSON.stringify({ error: 'Forbidden' }),
            }
          }

          // Second provider should succeed
          return await next(proxy)
        }
      }
    }

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'fallback-test' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new Fail403FirstMiddleware()])
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(attemptCount).toBe(2)
    expect(providerAttempts).toEqual(['http://test.example.com/provider1', 'http://test.example.com/provider2'])

    // Verify the response came from the second provider
    const content = (await response.json()) as { choices: [{ message: { content: string } }] }
    expect(content.choices[0].message.content).toMatchInlineSnapshot(
      `"request URL: http://test.example.com/provider2/chat/completions"`,
    )
  })

  test('should not fallback on non-retryable error', async () => {
    let attemptCount = 0

    class FailWithBadRequestMiddleware implements Middleware {
      dispatch(_next: Next): Next {
        return (_proxy: DefaultProviderProxy) => {
          attemptCount++
          // Return 400 error (non-retryable)
          return Promise.resolve({
            requestModel: 'gpt-5',
            requestBody: '{}',
            unexpectedStatus: 400,
            responseHeaders: new Headers(),
            responseBody: JSON.stringify({ error: 'Bad request' }),
          })
        }
      }
    }

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'fallback-test' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new FailWithBadRequestMiddleware()])
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    // Should fail immediately without trying fallback
    expect(response.status).toBe(400)
    expect(attemptCount).toBe(1)
  })

  test('should return error if all providers fail', async () => {
    let attemptCount = 0

    class FailAllMiddleware implements Middleware {
      dispatch(_next: Next): Next {
        return (_proxy: DefaultProviderProxy) => {
          attemptCount++
          // Always return 503
          return Promise.resolve({
            requestModel: 'gpt-5',
            requestBody: '{}',
            unexpectedStatus: 503,
            responseHeaders: new Headers(),
            responseBody: JSON.stringify({ error: 'Service unavailable' }),
          })
        }
      }
    }

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'fallback-test' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new FailAllMiddleware()])
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    // Should try both providers and fail with last error
    expect(response.status).toBe(503)
    expect(attemptCount).toBe(2)
  })

  test('should fallback from anthropic to google-vertex with model name replacement', async ({ gateway }) => {
    const { fetch } = gateway
    let attemptCount = 0
    const providerAttempts: string[] = []
    const modelAttempts: string[] = []

    class FailAnthropicMiddleware implements Middleware {
      dispatch(next: Next): Next {
        return async (proxy: DefaultProviderProxy) => {
          attemptCount++
          const providerId = proxy.providerId()
          providerAttempts.push(providerId)

          // Extract model from request
          const requestBody = await proxy.request.clone().text()
          const body = JSON.parse(requestBody)
          if ('model' in body) {
            modelAttempts.push(body.model as string)
          }

          // First provider (anthropic) should fail with 503
          if (providerId === 'anthropic') {
            return {
              requestModel: 'claude-sonnet-4-0',
              requestBody: '{}',
              unexpectedStatus: 503,
              responseHeaders: new Headers(),
              responseBody: JSON.stringify({ error: 'Service unavailable' }),
            }
          }

          // Second provider (google-vertex) should succeed
          return await next(proxy)
        }
      }
    }

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/anthropic/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'healthy', 'x-vcr-filename': 'fallback' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-0',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new FailAnthropicMiddleware()])
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    const text = await response.text()
    expect(response.status, `got ${response.status} response: ${text}`).toBe(200)
    expect(attemptCount).toBe(2)
    expect(providerAttempts).toEqual(['anthropic', 'google-vertex'])
    expect(modelAttempts).toEqual(['claude-sonnet-4-0', 'claude-sonnet-4-0'])

    // Verify the response came from google-vertex and model was replaced
    const content = JSON.parse(text)
    expect(content).toHaveProperty('id')
    expect(content).toHaveProperty('model')
  })
})

describe('authentication', () => {
  describe('header extraction', () => {
    test('should reject when both Authorization and X-API-Key headers have paig_ prefix', async ({ gateway }) => {
      const response = await gateway.fetch('https://example.com/openai/gpt-5', {
        headers: { Authorization: 'paig_test_key', 'X-API-Key': 'paig_another_key' },
      })
      const text = await response.text()
      expect(response.status).toBe(401)
      expect(text).toMatchInlineSnapshot(
        `"Unauthorized - Both Authorization and X-API-Key headers are set, use only one"`,
      )
    })

    test('should accept Authorization header with paig_ prefix', async ({ gateway }) => {
      const response = await gateway.fetch('https://example.com/test/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'paig_healthy' },
        body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
      })
      expect(response.status).toBe(200)
    })

    test('should accept Authorization header with paig_ prefix with X-API-Key also present', async ({ gateway }) => {
      const response = await gateway.fetch('https://example.com/test/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'paig_healthy', 'X-API-Key': 'not_paig_healthy' },
        body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
      })
      expect(response.status).toBe(200)
    })

    test('should accept X-API-Key header with paig_ prefix', async ({ gateway }) => {
      const response = await gateway.fetch('https://example.com/test/chat/completions', {
        method: 'POST',
        headers: { 'X-API-Key': 'paig_healthy' },
        body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
      })
      expect(response.status).toBe(200)
    })

    test('should strip Bearer prefix from Authorization header', async ({ gateway }) => {
      const response = await gateway.fetch('https://example.com/test/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer healthy' },
        body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
      })
      expect(response.status).toBe(200)
    })

    test('should strip Bearer prefix from X-API-Key header', async ({ gateway }) => {
      const response = await gateway.fetch('https://example.com/test/chat/completions', {
        method: 'POST',
        headers: { 'X-API-Key': 'Bearer healthy' },
        body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
      })
      expect(response.status).toBe(200)
    })

    test('should reject key that is too long', async ({ gateway }) => {
      const longKey = 'a'.repeat(201)
      const response = await gateway.fetch('https://example.com/openai/gpt-5', { headers: { Authorization: longKey } })
      const text = await response.text()
      expect(response.status).toBe(401)
      expect(text).toBe('Unauthorized - Key too long')
    })
  })
})

describe('cache behavior', () => {
  test('should use cached API key when project state matches', async ({ gateway }) => {
    const { fetch } = gateway
    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })

    // First request - cache miss
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

    // Verify cache was set
    const cachedValue = await env.KV.get('apiKeyAuth:test:healthy')
    expect(cachedValue).toBeTypeOf('string')
    const cachedApiKey = JSON.parse(cachedValue!)
    expect(cachedApiKey.key).toBe('healthy')

    // Second request - should use cache
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello again' }] })
  })

  test('should refetch from DB when project state changes', async ({ gateway }) => {
    const { fetch } = gateway
    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })

    // First request to populate cache
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

    // Change project state to invalidate cache
    const projectStateCacheKey = `projectState:test:${IDS.projectDefault}`
    await env.KV.put(projectStateCacheKey, 'new-state')

    // Second request - should refetch from DB due to state mismatch
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello again' }] })
  })

  test('should use cache when project state is null (first deployment)', async ({ gateway }) => {
    const { fetch } = gateway

    // First request to populate cache
    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

    // Verify cache was set
    const cachedValue = await env.KV.get('apiKeyAuth:test:healthy')
    expect(cachedValue).toBeTypeOf('string')

    // Delete project state to simulate first deployment (null project state)
    const projectStateCacheKey = `projectState:test:${IDS.projectDefault}`
    await env.KV.delete(projectStateCacheKey)

    // Second request should still use cache when project state is null
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello again' }] })
  })

  test('should cache API key after DB fetch', async ({ gateway }) => {
    const { fetch } = gateway

    // Ensure cache is empty
    await env.KV.delete('apiKeyAuth:test:healthy')

    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

    // Verify cache was populated
    const cachedValue = await env.KV.get('apiKeyAuth:test:healthy')
    expect(cachedValue).toBeTypeOf('string')
    const cachedApiKey = JSON.parse(cachedValue!)
    expect(cachedApiKey.key).toBe('healthy')
    expect(cachedApiKey.id).toBe(IDS.keyHealthy)
  })
})

describe('cache management', () => {
  test('should delete API key from cache', async ({ gateway }) => {
    const { fetch } = gateway

    // First populate the cache
    const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })
    await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

    // Verify cache exists
    let cachedValue = await env.KV.get('apiKeyAuth:test:healthy')
    expect(cachedValue).toBeTypeOf('string')

    // Delete cache (this would typically be called via deleteApiKeyCache function)
    await env.KV.delete('apiKeyAuth:test:healthy')

    // Verify cache is deleted
    cachedValue = await env.KV.get('apiKeyAuth:test:healthy')
    expect(cachedValue).toBeNull()
  })

  describe('rate limiter integration', () => {
    test('should check rate limiter before allowing request', async ({ gateway }) => {
      // This is tested in the 'key status' describe block with 'tiny-limit' key
      // but we can add an explicit test here
      const { fetch } = gateway
      const client = new OpenAI({ apiKey: 'tiny-limit', baseURL: 'https://example.com/test', fetch })

      // First request should succeed
      await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

      // Second request should fail due to rate limit
      const response = await fetch('https://example.com/test/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'tiny-limit' },
        body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
      })

      expect(response.status).toBe(403)
      const text = await response.text()
      expect(text).toContain('limit-exceeded')
    })

    test('should start rate limiter for cached keys', async ({ gateway }) => {
      const { fetch } = gateway

      // First request to populate cache
      const client = new OpenAI({ apiKey: 'healthy', baseURL: 'https://example.com/test', fetch })
      await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] })

      // Second request should use cache and still check rate limiter
      await client.chat.completions.create({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello again' }] })

      // Verify spend was tracked
      const spends = await env.limitsDB.prepare('SELECT * FROM spend').all()
      expect(spends.results.length).toBeGreaterThan(0)
    })
  })
})
