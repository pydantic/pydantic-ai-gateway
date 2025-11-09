import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import {
  type ApiKeyInfo,
  gatewayFetch,
  type LimiterResult,
  type Middleware,
  type Next,
  type RateLimiter,
} from '@pydantic/ai-gateway'
import { describe, expect } from 'vitest'
import type { DefaultProviderProxy } from '../src/providers/default'
import { test } from './setup'
import { buildGatewayEnv } from './worker'

class TestRateLimiter implements RateLimiter {
  requestStartCount: number = 0
  requestEndSlots: string[] = []
  error?: string

  constructor(error?: string) {
    this.error = error
  }

  requestStart(_: ApiKeyInfo): Promise<LimiterResult> {
    this.requestStartCount++
    if (this.error) {
      return Promise.resolve({ error: this.error })
    } else {
      return Promise.resolve({ slot: 'abc' })
    }
  }

  requestFinish(slot: string): Promise<void> {
    this.requestEndSlots.push(slot)
    return Promise.resolve()
  }
}

describe('rate limiter', () => {
  test('should call requestStart and requestFinish on successful request', async () => {
    const rateLimiter = new TestRateLimiter()
    const ctx = createExecutionContext()

    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'healthy' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, undefined, rateLimiter)
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    expect(rateLimiter.requestStartCount).toBe(1)
    expect(rateLimiter.requestEndSlots).toEqual(['abc'])
  })

  test('should call requestStart and requestFinish on failed request', async () => {
    const rateLimiter = new TestRateLimiter()

    class FailMiddleware implements Middleware {
      dispatch(_next: Next): Next {
        return (_proxy: DefaultProviderProxy) => {
          return Promise.resolve({
            requestModel: 'gpt-5',
            requestBody: '{}',
            unexpectedStatus: 500,
            responseHeaders: new Headers(),
            responseBody: JSON.stringify({ error: 'Internal server error' }),
          })
        }
      }
    }

    const ctx = createExecutionContext()
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'healthy' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, [new FailMiddleware()], rateLimiter)
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(500)
    expect(rateLimiter.requestStartCount).toBe(1)
    expect(rateLimiter.requestEndSlots).toEqual(['abc'])
  })

  test('should not call requestStart on invalid auth', async () => {
    const rateLimiter = new TestRateLimiter()
    const ctx = createExecutionContext()

    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'invalid-key' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, undefined, rateLimiter)
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(401)
    expect(rateLimiter.requestStartCount).toBe(0)
    expect(rateLimiter.requestEndSlots).toEqual([])
  })

  test('should call requestStart and requestFinish even when key is disabled', async () => {
    const rateLimiter = new TestRateLimiter()
    const ctx = createExecutionContext()

    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'disabled' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, undefined, rateLimiter)
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    // Disabled keys are still authenticated, so rate limiter is called
    expect(response.status).toBe(403)
    expect(rateLimiter.requestStartCount).toBe(1)
    expect(rateLimiter.requestEndSlots).toEqual(['abc'])
  })

  test('should return 429 when rate limiter returns error (cached key path)', async () => {
    const rateLimiter = new TestRateLimiter('Rate limit exceeded')
    const ctx = createExecutionContext()

    // First request to populate the cache
    const request1 = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'healthy' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv1 = buildGatewayEnv(env, [], fetch, undefined, undefined, new TestRateLimiter())
    await gatewayFetch(request1, new URL(request1.url), ctx, gatewayEnv1)
    await waitOnExecutionContext(ctx)

    // Second request should use cached key and hit rate limiter error
    const request2 = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'healthy' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv2 = buildGatewayEnv(env, [], fetch, undefined, undefined, rateLimiter)
    const response = await gatewayFetch(request2, new URL(request2.url), ctx, gatewayEnv2)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(429)
    const text = await response.text()
    expect(text).toBe('Rate limit exceeded')
    expect(rateLimiter.requestStartCount).toBe(1)
    // requestFinish should not be called since error was thrown
    expect(rateLimiter.requestEndSlots).toEqual([])
  })

  test('should return 429 when rate limiter returns error (fresh key path)', async () => {
    const rateLimiter = new TestRateLimiter('Too many requests')
    const ctx = createExecutionContext()

    // Use a fresh key that won't be cached
    const request = new Request<unknown, IncomingRequestCfProperties>('https://example.com/test/gpt-5', {
      method: 'POST',
      headers: { Authorization: 'healthy' },
      body: JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'Hello' }] }),
    })

    const gatewayEnv = buildGatewayEnv(env, [], fetch, undefined, undefined, rateLimiter)
    const response = await gatewayFetch(request, new URL(request.url), ctx, gatewayEnv)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(429)
    const text = await response.text()
    expect(text).toBe('Too many requests')
    expect(rateLimiter.requestStartCount).toBe(1)
    // requestFinish should not be called since error was thrown
    expect(rateLimiter.requestEndSlots).toEqual([])
  })
})
