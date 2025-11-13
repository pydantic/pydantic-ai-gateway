import type { GatewayOptions } from '.'
import type { RateLimiter } from './rateLimiter'
import type { ApiKeyInfo } from './types'
import { runAfter, textResponse } from './utils'

const CACHE_TTL = 86400 * 30

export async function apiKeyAuth(
  request: Request,
  ctx: ExecutionContext,
  options: GatewayOptions,
  rateLimiter: RateLimiter,
): Promise<ApiKeyInfo | Response> {
  const keyResult = getApiKey(request)
  if (keyResult instanceof Response) {
    return keyResult
  }
  const key = keyResult

  const cacheKey = apiKeyCacheKey(key, options.kvVersion)
  const cacheResult = await options.kv.getWithMetadata<ApiKeyInfo, string>(cacheKey, { type: 'json' })
  let rateLimiterStarted = false

  // if we have a cached api key, use that
  if (cacheResult?.value) {
    const apiKeyInfo = cacheResult.value
    const [projectState, limiterResult] = await Promise.all([
      options.kv.get(projectStateCacheKey(apiKeyInfo.project, options.kvVersion)),
      rateLimiter.requestStart(apiKeyInfo),
    ])
    const limiterResponse = processLimiterResult(limiterResult)
    if (limiterResponse) {
      return limiterResponse
    }
    // we only return a cache match if the project state is the same, so updating the project state invalidates the cache
    // projectState is null if we have never invalidated the cache which will only be true for the first request after a deployment
    if (projectState === null || projectState === cacheResult.metadata) {
      return apiKeyInfo
    }
    rateLimiterStarted = true
  }

  const apiKeyInfo = await options.keysDb.getApiKey(key)
  if (apiKeyInfo) {
    if (!rateLimiterStarted) {
      const limiterResult = await rateLimiter.requestStart(apiKeyInfo)
      const limiterResponse = processLimiterResult(limiterResult)
      if (limiterResponse) {
        return limiterResponse
      }
    }
    runAfter(ctx, 'setApiKeyCache', setApiKeyCache(apiKeyInfo, options))
    return apiKeyInfo
  }
  return textResponse(401, 'Unauthorized - Key not found')
}

export async function setApiKeyCache(
  apiKey: ApiKeyInfo,
  options: Pick<GatewayOptions, 'kv' | 'kvVersion'>,
  expirationTtl?: number,
) {
  const projectState = await options.kv.get(projectStateCacheKey(apiKey.project, options.kvVersion))

  await options.kv.put(apiKeyCacheKey(apiKey.key, options.kvVersion), JSON.stringify(apiKey), {
    metadata: projectState,
    // Note: 0 is a valid expirationTtl (for immediate cache expiry if, e.g., the user hits a limit at the end of an interval).
    // Do not use logical OR (||) for a fallback, as it would treat 0 as false and incorrectly default to CACHE_TTL,
    // potentially locking out the user much longer than intended.
    expirationTtl: expirationTtl ?? CACHE_TTL,
  })
}

export async function deleteApiKeyCache(
  apiKey: Pick<ApiKeyInfo, 'key'>,
  options: Pick<GatewayOptions, 'kv' | 'kvVersion'>,
) {
  await options.kv.delete(apiKeyCacheKey(apiKey.key, options.kvVersion))
}

export async function changeProjectState(project: number, options: Pick<GatewayOptions, 'kv' | 'kvVersion'>) {
  const cacheKey = projectStateCacheKey(project, options.kvVersion)
  await options.kv.put(cacheKey, crypto.randomUUID(), { expirationTtl: CACHE_TTL })
}

function getApiKey(request: Request): Response | string {
  const authorization = getHeaderKey(request, 'authorization')
  const xApiKey = getHeaderKey(request, 'x-api-key')

  if (authorization?.startsWith('paig_') && xApiKey?.startsWith('paig_')) {
    return textResponse(401, 'Unauthorized - Both Authorization and X-API-Key headers are set, use only one')
  }

  if (authorization?.startsWith('paig_')) {
    return authorization
  } else if (xApiKey?.startsWith('paig_')) {
    return xApiKey
  }
  const key = authorization || xApiKey
  if (key) {
    // avoid very long queries to the DB
    if (key.length > 200) {
      return textResponse(401, 'Unauthorized - Key too long')
    } else {
      return key
    }
  } else {
    return textResponse(401, 'Unauthorized - Missing Authorization Header')
  }
}

function getHeaderKey(request: Request, headerName: string): string | null {
  const header = request.headers.get(headerName)
  if (header) {
    return header.toLowerCase().startsWith('bearer ') ? header.substring(7) : header
  } else {
    return null
  }
}

const apiKeyCacheKey = (key: string, kvVersion: string) => `apiKeyAuth:${kvVersion}:${key}`
const projectStateCacheKey = (project: number, kvVersion: string) => `projectState:${kvVersion}:${project}`

function processLimiterResult(limiterResult: string | null) {
  if (typeof limiterResult === 'string') {
    return textResponse(429, limiterResult)
  }
}
