import type { CacheAdapter, CacheGetOptions, CacheGetWithMetadataResult, CachePutOptions } from './adapter'

/**
 * Cloudflare KV cache adapter.
 * Wraps KVNamespace to implement the generic CacheAdapter interface.
 */
export class KVCacheAdapter implements CacheAdapter {
  private readonly kv: KVNamespace

  constructor(kv: KVNamespace) {
    this.kv = kv
  }

  async get<T = string>(key: string, options?: CacheGetOptions): Promise<T | null> {
    const type = options?.type || 'text'
    const kvGetOptions: Record<string, unknown> = { type: type as 'text' | 'json' | 'arrayBuffer' }
    if (options?.cacheTtl !== undefined) {
      kvGetOptions.cacheTtl = options.cacheTtl
    }

    const result = await this.kv.get(key, kvGetOptions as never)

    return result as T | null
  }

  async getWithMetadata<T, M = string>(
    key: string,
    options?: CacheGetOptions,
  ): Promise<CacheGetWithMetadataResult<T, M>> {
    const type = options?.type || 'text'
    const kvGetOptions: Record<string, unknown> = { type: type as 'text' | 'json' | 'arrayBuffer' }
    if (options?.cacheTtl !== undefined) {
      kvGetOptions.cacheTtl = options.cacheTtl
    }

    const result = await this.kv.getWithMetadata<T, M>(key, kvGetOptions as never)

    return {
      value: (result.value ?? undefined) as T | undefined,
      metadata: (result.metadata ?? undefined) as M | undefined,
    }
  }

  async put(key: string, value: string, options?: CachePutOptions): Promise<void> {
    const kvOptions: KVNamespacePutOptions = {}

    if (options?.expirationTtl !== undefined) {
      kvOptions.expirationTtl = options.expirationTtl
    }

    if (options?.metadata !== undefined) {
      kvOptions.metadata = options.metadata
    }

    await this.kv.put(key, value, kvOptions)
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key)
  }
}
