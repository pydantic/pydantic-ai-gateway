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
import type { SubFetch } from './types'
import { ctHeader, response405, ResponseError } from './utils'

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
▗▄▄▖  ▗▄▖ ▗▄▄▄▖ ▗▄▄▖
▐▌ ▐▌▐▌ ▐▌  █  ▐▌
▐▛▀▘ ▐▛▀▜▌  █  ▐▌▝▜▌
▐▌   ▐▌ ▐▌▗▄█▄▖▝▚▄▞▘

Pydantic AI Gateway

git sha: ${env.githubSha}
GitHub: https://github.com/pydantic/pydantic-ai-gateway
To connect, point your application at ${request.url}<provider-id>
`,
      { headers: ctHeader('text/plain; charset=utf-8') },
    )
  } else if (request.method === 'HEAD') {
    return new Response('', { headers: ctHeader('text/html') })
  } else {
    return response405('GET', 'HEAD')
  }
}
