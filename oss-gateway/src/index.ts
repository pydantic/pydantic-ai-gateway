import * as logfire from '@pydantic/logfire-api'
import { instrument } from '@pydantic/logfire-cf-workers'
import { gatewayFetch, GatewayEnv, LimitDbD1 } from '@pydantic/ai-gateway'
import { ConfigDB } from './db'

const handler = {
  async fetch(request, env, ctx): Promise<Response> {
    const gatewayEnv: GatewayEnv = {
      githubSha: env.GITHUB_SHA,
      keysDb: new ConfigDB(),
      limitDb: new LimitDbD1(env.limitsDB),
      kv: env.KV,
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
  },
})
