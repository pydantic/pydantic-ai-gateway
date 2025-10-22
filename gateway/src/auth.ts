import type { GatewayOptions } from '.'
import type { ApiKeyInfo } from './types'
import { ResponseError, runAfter } from './utils'

const CACHE_TTL = 86400 * 30

export async function apiKeyAuth(
  request: Request,
  ctx: ExecutionContext,
  options: GatewayOptions,
): Promise<ApiKeyInfo> {
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

  const cacheKey = apiKeyCacheKey(key, options.kvVersion)
  const cacheResult = await options.kv.getWithMetadata<ApiKeyInfo, string>(cacheKey, { type: 'json' })

  if (cacheResult?.value) {
    const apiKey = cacheResult.value
    const projectState = await options.kv.get(projectStateCacheKey(apiKey.project, options.kvVersion))
    // we only return a cache match if the project state is the same, so updating the project state invalidates the cache
    // projectState is null if we have never invalidated the cache which will only be true for the first request after a deployment
    if (projectState === null || projectState === cacheResult.metadata) {
      return apiKey
    }
  }

  const apiKey = await options.keysDb.getApiKey(key)
  if (apiKey) {
    runAfter(ctx, 'setApiKeyCache', setApiKeyCache(apiKey, options))
    return apiKey
  }
  throw new ResponseError(401, 'Unauthorized - Key not found')
}

export async function setApiKeyCache(
  apiKey: ApiKeyInfo,
  options: Pick<GatewayOptions, 'kv' | 'kvVersion'>,
  expirationTtl?: number,
) {
  const projectState = await options.kv.get(projectStateCacheKey(apiKey.project, options.kvVersion))

  await options.kv.put(apiKeyCacheKey(apiKey.key, options.kvVersion), JSON.stringify(apiKey), {
    metadata: projectState,
    expirationTtl: expirationTtl || CACHE_TTL,
  })
}

export async function deleteApiKeyCache(apiKey: ApiKeyInfo, options: Pick<GatewayOptions, 'kv' | 'kvVersion'>) {
  await options.kv.delete(apiKeyCacheKey(apiKey.key, options.kvVersion))
}

export async function changeProjectState(project: number, options: Pick<GatewayOptions, 'kv' | 'kvVersion'>) {
  const cacheKey = projectStateCacheKey(project, options.kvVersion)
  await options.kv.put(cacheKey, crypto.randomUUID(), { expirationTtl: CACHE_TTL })
}

const apiKeyCacheKey = (key: string, kvVersion: string) => `apiKeyAuth:${kvVersion}:${key}`
const projectStateCacheKey = (project: number, kvVersion: string) => `projectState:${kvVersion}:${project}`
