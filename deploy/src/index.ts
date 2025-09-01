import { env } from 'cloudflare:workers'
import * as logfire from '@pydantic/logfire-api'
import { instrument } from '@pydantic/logfire-cf-workers'
import { gatewayFetch, GatewayEnv, LimitDbD1 } from '@pydantic/ai-gateway'
import { CONFIG_VERSION } from './config'
import { ConfigDB } from './db'

const VERSION = `${env.GITHUB_SHA.substring(0, 7)}-${CONFIG_VERSION}`

const handler = {
  async fetch(request, env, ctx): Promise<Response> {
    const gatewayEnv: GatewayEnv = {
      githubSha: env.GITHUB_SHA,
      keysDb: new ConfigDB(env),
      limitDb: new LimitDbD1(env.limitsDB),
      kv: env.KV,
      kvVersion: VERSION,
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
    version: VERSION,
  },
})
