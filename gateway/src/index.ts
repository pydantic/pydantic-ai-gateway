/*
Copyright (C) 2025 to present Pydantic Services Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import * as logfire from '@pydantic/logfire-api'
import type { KeysDb, LimitDb } from './db'
import { gateway } from './gateway'
import type { DefaultProviderProxy, Middleware, Next } from './providers/default'
import type { SubFetch } from './types'
import { ctHeader, ResponseError, response405, textResponse } from './utils'

export type { DefaultProviderProxy, Middleware, Next }
export * from './db'
export * from './types'

export interface GatewayEnv {
  githubSha: string
  keysDb: KeysDb
  limitDb: LimitDb
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
  env: GatewayEnv,
): Promise<Response> {
  let { pathname: proxyPath } = url
  if (env.proxyPrefixLength) {
    proxyPath = proxyPath.slice(env.proxyPrefixLength)
  }
  try {
    if (proxyPath === '/') {
      return index(request, env)
    } else {
      return await gateway(request, proxyPath, ctx, env)
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
  const url = request.url.replace(/\/$/, '')
  if (request.method === 'GET') {
    return new Response(
      `\
▗▄▄▖  ▗▄▖ ▗▄▄▄▖ ▗▄▄▖
▐▌ ▐▌▐▌ ▐▌  █  ▐▌
▐▛▀▘ ▐▛▀▜▌  █  ▐▌▝▜▌
▐▌   ▐▌ ▐▌▗▄█▄▖▝▚▄▞▘

Pydantic AI Gateway

git SHA: ${env.githubSha}
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
