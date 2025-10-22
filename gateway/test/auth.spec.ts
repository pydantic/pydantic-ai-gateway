/** biome-ignore-all lint/suspicious/useAwait: don't care in tests */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import type { KeysDb } from '@pydantic/ai-gateway'
import { describe, expect } from 'vitest'
import { apiKeyAuth, changeProjectState } from '../src/auth'
import type { ApiKeyInfo, KeyStatus } from '../src/types'
import { test } from './setup'
import { buildGatewayEnv, IDS } from './worker'

class CountingKeysDb implements KeysDb {
  callCount = 0
  private wrapped: KeysDb

  constructor(wrapped: KeysDb) {
    this.wrapped = wrapped
  }

  async getApiKey(key: string): Promise<ApiKeyInfo | null> {
    this.callCount++
    return this.wrapped.getApiKey(key)
  }

  async disableKey(id: number, reason: string, newStatus: KeyStatus, expirationTtl?: number): Promise<void> {
    return this.wrapped.disableKey(id, reason, newStatus, expirationTtl)
  }
}

describe('apiKeyAuth cache invalidation', () => {
  test('caches api key and returns cached value', async () => {
    const ctx = createExecutionContext()
    const baseOptions = buildGatewayEnv(env, [], fetch)
    const countingDb = new CountingKeysDb(baseOptions.keysDb)
    const options = { ...baseOptions, keysDb: countingDb }

    const request = new Request('https://example.com', { headers: { Authorization: 'healthy' } })

    // First call should fetch from DB
    const apiKey1 = await apiKeyAuth(request, ctx, options)
    expect(apiKey1.key).toBe('healthy')
    // Wait for cache to be set (it's set asynchronously via runAfter)
    await waitOnExecutionContext(ctx)
    expect(countingDb.callCount).toBe(1)

    // Verify cache was set
    const cached = await env.KV.get('apiKeyAuth:test:healthy')
    expect(cached).toBeTypeOf('string')

    // Second call should use cache, not hit DB
    const ctx2 = createExecutionContext()
    const apiKey2 = await apiKeyAuth(request, ctx2, options)
    expect(apiKey2.key).toBe('healthy')

    expect(countingDb.callCount).toBe(1)
  })

  test('invalidates cache when project state changes', async () => {
    const ctx = createExecutionContext()
    const baseOptions = buildGatewayEnv(env, [], fetch)
    const countingDb = new CountingKeysDb(baseOptions.keysDb)
    const options = { ...baseOptions, keysDb: countingDb }

    const request = new Request('https://example.com', { headers: { Authorization: 'healthy' } })

    // First call - fetch from DB and cache
    await apiKeyAuth(request, ctx, options)
    await waitOnExecutionContext(ctx)
    expect(countingDb.callCount).toBe(1)

    const cached1 = await env.KV.getWithMetadata('apiKeyAuth:test:healthy')
    expect(cached1.value).not.toBeNull()
    expect(cached1.metadata).toBeNull()

    // Second call - should use cache, not hit DB
    const ctx2 = createExecutionContext()
    await apiKeyAuth(request, ctx2, options)
    await waitOnExecutionContext(ctx2)
    expect(countingDb.callCount).toBe(1)

    // Change project state - this invalidates the cache
    await changeProjectState(IDS.projectDefault, options)

    const projectState = await env.KV.get(`projectState:test:${IDS.projectDefault}`)
    expect(projectState).not.toBeNull()

    // Third call - cache is invalidated, should hit DB again
    const ctx3 = createExecutionContext()
    const apiKey3 = await apiKeyAuth(request, ctx3, options)
    expect(apiKey3.key).toBe('healthy')
    await waitOnExecutionContext(ctx3)

    expect(countingDb.callCount).toBe(2)
  })
})
