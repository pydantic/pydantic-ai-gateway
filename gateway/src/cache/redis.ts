import type { CacheAdapter, CacheGetOptions, CacheGetWithMetadataResult, CachePutOptions } from './adapter'

/**
 * Minimal Redis client interface required by the adapter.
 * This allows compatibility with various Redis clients (ioredis, node-redis, upstash, etc.)
 */
export interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { EX?: number; EXAT?: number }): Promise<string | null>
  del(key: string): Promise<number>
}

/**
 * Redis cache adapter.
 * Implements the generic CacheAdapter interface using a Redis client.
 *
 * Metadata Support:
 * - Since Redis doesn't natively support metadata like KV, we store metadata
 *   as a separate key: `{originalKey}:metadata`
 * - This maintains compatibility with the cache invalidation strategy used in auth.ts
 *
 * ArrayBuffer Support:
 * - The `get` method supports reading base64-encoded strings as ArrayBuffers
 * - When using `put`, ArrayBuffer values must be pre-encoded to base64 strings
 * - This is necessary because Redis stores string values, not binary data
 *
 * CacheTtl Option:
 * - The `cacheTtl` option in CacheGetOptions is KV-specific for Cloudflare's edge caching
 * - This option is ignored by the Redis adapter as it only affects KV behavior
 */
export class RedisCacheAdapter implements CacheAdapter {
  private readonly redis: RedisClient

  constructor(redis: RedisClient) {
    this.redis = redis
  }

  async get<T = string>(key: string, options?: CacheGetOptions): Promise<T | null> {
    const value = await this.redis.get(key)

    if (value === null) {
      return null
    }

    // Handle different type options
    const type = options?.type || 'text'

    if (type === 'json') {
      try {
        return JSON.parse(value) as T
      } catch {
        return null
      }
    }

    if (type === 'arrayBuffer') {
      // Convert base64 string back to ArrayBuffer
      const binaryString = atob(value)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes.buffer as T
    }

    return value as T
  }

  async getWithMetadata<T, M = string>(
    key: string,
    options?: CacheGetOptions,
  ): Promise<CacheGetWithMetadataResult<T, M>> {
    // Fetch both value and metadata in parallel
    const [value, metadata] = await Promise.all([this.get<T>(key, options), this.redis.get(`${key}:metadata`)])

    return { value: value ?? undefined, metadata: (metadata ?? undefined) as M | undefined }
  }

  async put(key: string, value: string, options?: CachePutOptions): Promise<void> {
    const redisOptions: { EX?: number } = {}

    // Handle TTL
    if (options?.expirationTtl !== undefined) {
      redisOptions.EX = options.expirationTtl
    }

    // Store the value
    await this.redis.set(key, value, redisOptions)

    // Store metadata separately if provided
    if (options?.metadata !== undefined) {
      await this.redis.set(`${key}:metadata`, options.metadata, redisOptions)
    }
  }

  async delete(key: string): Promise<void> {
    // Delete both the value and metadata
    await Promise.all([this.redis.del(key), this.redis.del(`${key}:metadata`)])
  }
}
