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

import { env } from 'cloudflare:workers'
import * as logfire from '@pydantic/logfire-api'
import { instrument } from '@pydantic/logfire-cf-workers'
import { gatewayFetch, GatewayEnv, LimitDbD1 } from '@pydantic/ai-gateway'
import { config } from './config'
import { ConfigDB, hash } from './db'

const handler = {
  async fetch(request, env, ctx): Promise<Response> {
    const gatewayEnv: GatewayEnv = {
      githubSha: env.GITHUB_SHA,
      keysDb: new ConfigDB(env.limitsDB),
      limitDb: new LimitDbD1(env.limitsDB),
      kv: env.KV,
      kvVersion: await hash(JSON.stringify(config)),
      subFetch: fetch,
    }
    try {
      return await gatewayFetch(request, ctx, gatewayEnv)
    } catch (error) {
      console.error('Internal Server Error:', error)
      logfire.reportError('Internal Server Error', error as Error)
      return new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } })
    }
  },
} satisfies ExportedHandler<Env>

export default instrument(handler, {
  service: {
    name: 'gateway',
    version: env.GITHUB_SHA.substring(0, 7),
  },
})
