import type { KeysDb, LimitDb } from './db'
import { gateway } from './gateway'
import type { DefaultProviderProxy, Middleware, Next } from './providers/default'
import type { RateLimiter } from './rateLimiter'
import type { SubFetch } from './types'
import { ctHeader, response405, runAfter, textResponse } from './utils'

export { changeProjectState as setProjectState, deleteApiKeyCache, setApiKeyCache } from './auth'
export type { DefaultProviderProxy, Middleware, Next }
export * from './db'
export * from './rateLimiter'
export * from './types'

export interface GatewayOptions {
  githubSha: string
  keysDb: KeysDb
  limitDb: LimitDb
  rateLimiter?: RateLimiter
  kv: KVNamespace
  kvVersion: string
  subFetch: SubFetch
  /** number of characters to strip from the beginning of the path */
  proxyPrefixLength?: number
  /** proxyMiddlewares: perform actions before and after the request is made to the providers */
  proxyMiddlewares?: Middleware[]
}

export async function gatewayFetch(
  request: Request,
  url: URL,
  ctx: ExecutionContext,
  options: GatewayOptions,
): Promise<Response> {
  let { pathname: proxyPath, search: queryString } = url
  if (options.proxyPrefixLength) {
    proxyPath = proxyPath.slice(options.proxyPrefixLength)
  }
  if (proxyPath === '/') {
    return index(request, options)
  } else {
    const gatewayPromise = gateway(request, `${proxyPath}${queryString}`, ctx, options)
    runAfter(ctx, 'gatewayPromise', gatewayPromise)
    return await gatewayPromise
  }
}

function index(request: Request, options: GatewayOptions): Response {
  const url = request.url.replace(/\/$/, '')
  if (request.method === 'GET') {
    return new Response(
      `\
▗▄▄▖  ▗▄▖ ▗▄▄▄▖ ▗▄▄▖
▐▌ ▐▌▐▌ ▐▌  █  ▐▌
▐▛▀▘ ▐▛▀▜▌  █  ▐▌▝▜▌
▐▌   ▐▌ ▐▌▗▄█▄▖▝▚▄▞▘

Pydantic AI Gateway

git SHA: ${options.githubSha}
GitHub: https://github.com/pydantic/pydantic-ai-gateway
To connect, point your application at ${url}/<provider-id>
`,
      { headers: ctHeader('text/plain; charset=utf-8') },
    )
  } else if (request.method === 'HEAD') {
    return textResponse(200, '')
  } else {
    return response405('GET', 'HEAD')
  }
}
