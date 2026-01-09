import { env } from 'cloudflare:test'
import { KVCacheAdapter, RedisCacheAdapter, type RedisClient } from '@pydantic/ai-gateway'
import type { Redis as IORedisClient } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Adapter to make ioredis compatible with our RedisClient interface
 */
class IORedisAdapter implements RedisClient {
  constructor(private readonly client: IORedisClient) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, options?: { EX?: number; EXAT?: number }): Promise<string | null> {
    if (options?.EX) {
      await this.client.set(key, value, 'EX', options.EX)
    } else if (options?.EXAT) {
      await this.client.set(key, value, 'EXAT', options.EXAT)
    } else {
      await this.client.set(key, value)
    }
    return 'OK'
  }

  del(key: string): Promise<number> {
    return this.client.del(key)
  }
}

let ioredis: IORedisClient | null = null
let redis: RedisClient | null = null
let redisAvailable = false

// Try to connect to Redis before running tests
beforeAll(async () => {
  try {
    // Dynamically import ioredis to avoid issues in Cloudflare Workers environment
    const { default: Redis } = await import('ioredis')

    ioredis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      // Use a test database
      db: 15,
      lazyConnect: true,
      // Short timeout for quick failure if Redis is not available
      connectTimeout: 2000,
    })

    await ioredis.connect()
    redis = new IORedisAdapter(ioredis)
    redisAvailable = true
    console.log('✓ Connected to Redis for testing')
  } catch (_error) {
    console.warn('⚠ Redis not available, skipping Redis tests. Start Redis with: docker-compose up -d')
    redisAvailable = false
    if (ioredis) {
      ioredis.disconnect()
      ioredis = null
    }
  }
})

afterAll(async () => {
  if (ioredis) {
    // Clean up test keys
    await ioredis.flushdb()
    ioredis.disconnect()
  }
})

describe('RedisCacheAdapter', () => {
  it.skipIf(!redisAvailable)('should store and retrieve text values', async () => {
    if (!redis) return
    const cache = new RedisCacheAdapter(redis)

    await cache.put('test-key', 'test-value')
    const result = await cache.get('test-key')

    expect(result).toBe('test-value')
  })

  it.skipIf(!redisAvailable)('should store and retrieve JSON values', async () => {
    if (!redis) return
    const cache = new RedisCacheAdapter(redis)

    const data = { id: 1, name: 'test', active: true }
    await cache.put('test-key', JSON.stringify(data))
    const result = await cache.get<typeof data>('test-key', { type: 'json' })

    expect(result).toEqual(data)
  })

  it.skipIf(!redisAvailable)('should return null for non-existent keys', async () => {
    if (!redis) return
    const cache = new RedisCacheAdapter(redis)

    const result = await cache.get('non-existent')
    expect(result).toBeNull()
  })

  it.skipIf(!redisAvailable)('should delete keys', async () => {
    if (!redis) return
    const cache = new RedisCacheAdapter(redis)

    await cache.put('test-key', 'test-value')
    await cache.delete('test-key')
    const result = await cache.get('test-key')

    expect(result).toBeNull()
  })

  it.skipIf(!redisAvailable)('should handle metadata with getWithMetadata', async () => {
    if (!redis) return
    const cache = new RedisCacheAdapter(redis)

    await cache.put('test-key', 'test-value', { metadata: 'meta-info' })
    const result = await cache.getWithMetadata('test-key')

    expect(result.value).toBe('test-value')
    expect(result.metadata).toBe('meta-info')
  })

  it.skipIf(!redisAvailable)('should handle TTL expiration', async () => {
    if (!redis) return
    const cache = new RedisCacheAdapter(redis)

    // Set with 1 second TTL
    await cache.put('test-key', 'test-value', { expirationTtl: 1 })

    // Should exist immediately
    let result = await cache.get('test-key')
    expect(result).toBe('test-value')

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // Should be expired
    result = await cache.get('test-key')
    expect(result).toBeNull()
  })

  it.skipIf(!redisAvailable)('should delete both value and metadata', async () => {
    if (!redis || !ioredis) return
    const cache = new RedisCacheAdapter(redis)

    await cache.put('key1', 'value1', { metadata: 'meta1' })

    // Check both keys exist using ioredis directly
    const value = await ioredis.get('key1')
    const metadata = await ioredis.get('key1:metadata')
    expect(value).toBe('value1')
    expect(metadata).toBe('meta1')

    await cache.delete('key1')

    // Both should be deleted
    const deletedValue = await ioredis.get('key1')
    const deletedMetadata = await ioredis.get('key1:metadata')
    expect(deletedValue).toBeNull()
    expect(deletedMetadata).toBeNull()
  })
})

describe('KVCacheAdapter', () => {
  it('should work with Cloudflare KV namespace', async () => {
    // This test will use the actual KV namespace from the test environment
    const cache = new KVCacheAdapter(env.KV)

    await cache.put('test-key', 'test-value')
    const result = await cache.get('test-key')

    expect(result).toBe('test-value')

    // Cleanup
    await cache.delete('test-key')
  })

  it('should handle JSON values', async () => {
    const cache = new KVCacheAdapter(env.KV)

    const data = { id: 1, name: 'test' }
    await cache.put('test-json', JSON.stringify(data))
    const result = await cache.get<typeof data>('test-json', { type: 'json' })

    expect(result).toEqual(data)

    // Cleanup
    await cache.delete('test-json')
  })

  it('should handle metadata', async () => {
    const cache = new KVCacheAdapter(env.KV)

    await cache.put('test-meta', 'value', { metadata: 'some-metadata' })
    const result = await cache.getWithMetadata('test-meta')

    expect(result.value).toBe('value')
    expect(result.metadata).toBe('some-metadata')

    // Cleanup
    await cache.delete('test-meta')
  })
})
