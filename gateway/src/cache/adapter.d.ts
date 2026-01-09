/**
 * Generic cache adapter interface that abstracts caching operations.
 * Supports both Cloudflare KV and Redis implementations.
 */

export interface CacheGetOptions {
  /** Cache TTL in seconds for the get operation (KV-specific) */
  cacheTtl?: number
  /** Type of data to retrieve */
  type?: 'json' | 'text' | 'arrayBuffer'
}

export interface CachePutOptions {
  /** Time-to-live in seconds until the key expires */
  expirationTtl?: number
  /** Optional metadata to store with the value (for cache invalidation) */
  metadata?: string
}

export interface CacheGetWithMetadataResult<T, M = string> {
  value?: T
  metadata?: M
}

/**
 * Abstract cache adapter interface.
 * Implementations should handle serialization/deserialization as needed.
 */
export interface CacheAdapter {
  /**
   * Retrieve a value from cache
   * @param key Cache key
   * @param options Options including type and cacheTtl
   * @returns The cached value or null if not found
   */
  get<T = string>(key: string, options?: CacheGetOptions): Promise<T | null>

  /**
   * Retrieve a value from cache along with its metadata
   * @param key Cache key
   * @param options Options including type and cacheTtl
   * @returns Object containing value and metadata, or empty if not found
   */
  getWithMetadata<T, M = string>(key: string, options?: CacheGetOptions): Promise<CacheGetWithMetadataResult<T, M>>

  /**
   * Store a value in cache
   * @param key Cache key
   * @param value Value to store (will be stringified if necessary)
   * @param options Options including TTL and metadata
   */
  put(key: string, value: string, options?: CachePutOptions): Promise<void>

  /**
   * Delete a value from cache
   * @param key Cache key to delete
   */
  delete(key: string): Promise<void>
}
