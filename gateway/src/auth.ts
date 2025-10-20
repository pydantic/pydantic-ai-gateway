import type { GatewayOptions } from '.'
import type { ApiKeyInfo } from './types'
import { ResponseError } from './utils'

const CACHE_VERSION = 1
const CACHE_TTL = 86400

export async function apiKeyAuth(request: Request, options: GatewayOptions): Promise<ApiKeyInfo> {
  const authHeader = request.headers.get('authorization')

  let key: string
  if (authHeader) {
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      key = authHeader.substring(7)
    } else {
      key = authHeader
    }
  } else {
    throw new ResponseError(401, 'Unauthorized - Missing Authorization Header')
  }
  // avoid very long queries to the DB
  if (key.length > 100) {
    throw new ResponseError(401, 'Unauthorized - Key too long')
  }

  const cacheKey = apiKeyCacheKey(key, options)
  const cacheResult = await options.kv.getWithMetadata<ApiKeyInfo, number>(cacheKey, { type: 'json' })

  let apiKey: ApiKeyInfo | null
  if (cacheResult && cacheResult.metadata === CACHE_VERSION && cacheResult.value) {
    apiKey = cacheResult.value
  } else {
    apiKey = await options.keysDb.getApiKey(key)
    if (!apiKey) {
      throw new ResponseError(401, 'Unauthorized - Key not found')
    }
    await options.kv.put(cacheKey, JSON.stringify(apiKey), { metadata: CACHE_VERSION, expirationTtl: CACHE_TTL })
  }
  // check all key validity in gateway.ts
  return apiKey
}

export async function disableApiKeyAuth(apiKey: ApiKeyInfo, options: GatewayOptions, expirationTtl?: number) {
  const cacheKey = apiKeyCacheKey(apiKey.key, options)
  await options.kv.put(cacheKey, JSON.stringify(apiKey), { metadata: CACHE_VERSION, expirationTtl })
}

const apiKeyCacheKey = (key: string, options: GatewayOptions) => `apiKeyAuth:${options.kvVersion}:${key}`
