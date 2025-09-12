import * as logfire from '@pydantic/logfire-api'
import { gateway } from './gateway'
import { ctHeader, response405, ResponseError } from './utils'
import type { KeysDb, LimitDb } from './db'
import type { SubFetch } from './types'

export * from './db'
export * from './types'

export interface GatewayEnv {
  githubSha: string
  keysDb: KeysDb
  limitDb: LimitDb
  kv: KVNamespace
  kvVersion: string
  subFetch: SubFetch
}

export async function gatewayFetch(request: Request, ctx: ExecutionContext, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url)
  try {
    if (url.pathname === '/') {
      return index(request, env)
    } else {
      return await gateway(request, ctx, env)
    }
  } catch (error) {
    if (error instanceof ResponseError) {
      logfire.reportError('ResponseError', error)
      return error.response()
    } else {
      throw error
    }
  }
}

function index(request: Request, env: GatewayEnv): Response {
  if (request.method === 'GET') {
    return new Response(
      `\
<h1>Pydantic AI Gateway</h1>
<p>release: ${env.githubSha.substring(0, 7)}</p>
`,
      {
        headers: ctHeader('text/html'),
      },
    )
  } else if (request.method === 'HEAD') {
    return new Response('', { headers: ctHeader('text/html') })
  } else {
    return response405('GET', 'HEAD')
  }
}
