export interface CachedResponse {
  status: number
  headers: Record<string, string>
  body: string
  timestamp: number
  requestModel?: string
  responseModel?: string
}

export interface CacheStorage {
  get(hash: string): Promise<CachedResponse | null>
  set(hash: string, response: CachedResponse): Promise<void>
}

export class KVCacheStorage implements CacheStorage {
  private kv: KVNamespace
  private namespace: string
  private ttl: number

  constructor(kv: KVNamespace, namespace: string = 'response', ttl: number = 86400) {
    this.kv = kv
    this.namespace = namespace
    this.ttl = ttl
  }

  async get(hash: string): Promise<CachedResponse | null> {
    const kvKey = cacheKey(this.namespace, hash)
    return await this.kv.get<CachedResponse>(kvKey, 'json')
  }

  async set(hash: string, response: CachedResponse): Promise<void> {
    const kvKey = cacheKey(this.namespace, hash)
    await this.kv.put(kvKey, JSON.stringify(response), { expirationTtl: this.ttl })
  }
}

const cacheKey = (namespace: string, hash: string): string => `${namespace}:${hash}`
