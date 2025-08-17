import { ApiKeyInfo } from './types'
import { GatewayEnv } from '.'
import { ResponseError } from './utils'

const CACHE_VERSION = 1
const CACHE_TTL = 86400

export async function apiKeyAuth(request: Request, env: GatewayEnv): Promise<ApiKeyInfo> {
  const authHeader = request.headers.get('authorization')

  let key
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

  let cacheKey = apiKeyCacheKey(key, env)
  const cacheResult = await env.kv.getWithMetadata<ApiKeyInfo, number>(cacheKey, { type: 'json' })

  let apiKey
  if (cacheResult && cacheResult.metadata === CACHE_VERSION && cacheResult.value) {
    apiKey = cacheResult.value
  } else {
    apiKey = await env.keysDb.apiKeyAuth(key)
    if (!apiKey) {
      throw new ResponseError(401, 'Unauthorized - Key not found')
    }
    await env.kv.put(cacheKey, JSON.stringify(apiKey), {
      metadata: CACHE_VERSION,
      expirationTtl: CACHE_TTL,
    })
  }

  if (apiKey.active) {
    return apiKey
  } else {
    throw new ResponseError(403, 'Unauthorized - Key not active')
  }
}

export async function disableApiKeyAuth(apiKey: ApiKeyInfo, env: GatewayEnv) {
  apiKey.active = false
  const cacheKey = apiKeyCacheKey(apiKey.key, env)
  await env.kv.put(cacheKey, JSON.stringify(apiKey), {
    metadata: CACHE_VERSION,
    expirationTtl: CACHE_TTL, // TODO this need to be customed to the disabled time
  })
}

const apiKeyCacheKey = (key: string, env: GatewayEnv) => `apiKeyAuth:${env.kvVersion}:${key}`
