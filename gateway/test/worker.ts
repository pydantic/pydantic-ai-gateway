import {
  type ApiKeyInfo,
  type GatewayEnv,
  gatewayFetch,
  KeysDbD1,
  LimitDbD1,
  type ProviderProxy,
  type SubFetch,
} from '@pydantic/ai-gateway'
import type { Middleware } from '../src/providers/default'

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return await gatewayFetch(request, ctx, buildGatewayEnv(env, [], fetch))
  },
} satisfies ExportedHandler<Env>

export interface DisableEvent {
  id: number
  reason: string
  newStatus: string
  expirationTtl?: number
}

export function buildGatewayEnv(
  env: Env,
  disableEvents: DisableEvent[],
  subFetch: SubFetch,
  proxyRegex?: RegExp,
  proxyMiddlewares?: Middleware[],
): GatewayEnv {
  return {
    githubSha: 'test',
    keysDb: new TestKeysDB(env, disableEvents),
    limitDb: new LimitDbD1(env.limitsDB),
    kv: env.KV,
    kvVersion: 'test',
    subFetch,
    proxyRegex,
    proxyMiddlewares,
  }
}

export namespace IDS {
  export const teamDefault = 1
  export const userDefault = 2
  export const keyHealthy = 3
  export const keyDisabled = 4
  export const keyTinyLimit = 5
}

class TestKeysDB extends KeysDbD1 {
  allProviders: ProviderProxy[]
  disableEvents: DisableEvent[]

  constructor(env: Env, disableEvents: DisableEvent[]) {
    super(env.limitsDB)
    this.disableEvents = disableEvents
    this.allProviders = [
      { baseUrl: 'http://test.example.com/test', providerId: 'test', injectCost: true, credentials: 'test' },
      {
        // baseUrl decides what URL the request will be forwarded to
        baseUrl: 'http://localhost:8005/openai',
        // providerId decides on the logic used to process the request and response
        providerId: 'openai',
        // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
        injectCost: true,
        // credentials are used by the ProviderProxy to authenticate the forwarded request
        credentials: env.OPENAI_API_KEY,
      },
      { baseUrl: 'http://localhost:8005/groq', providerId: 'groq', injectCost: true, credentials: env.GROQ_API_KEY },
      {
        baseUrl: 'http://localhost:8005/anthropic',
        providerId: 'anthropic',
        injectCost: true,
        credentials: env.ANTHROPIC_API_KEY,
      },
    ]
  }

  async getApiKey(key: string): Promise<ApiKeyInfo | null> {
    switch (key) {
      case 'healthy':
        return {
          id: IDS.keyHealthy,
          user: IDS.userDefault,
          team: IDS.teamDefault,
          key,
          status: (await this.getDbKeyStatus(IDS.keyHealthy)) ?? 'active',
          // key limits
          keySpendingLimitDaily: 1,
          keySpendingLimitTotal: 2,
          // user limits
          userSpendingLimitWeekly: 3,
          // team limits
          teamSpendingLimitMonthly: 4,
          providers: this.allProviders,
          otelSettings: {
            writeToken: 'write-token',
            baseUrl: 'https://logfire.pydantic.dev',
            exporterProtocol: 'http/json',
          },
        }
      case 'disabled':
        return { id: IDS.keyDisabled, team: IDS.teamDefault, key, status: 'disabled', providers: this.allProviders }
      case 'tiny-limit':
        return {
          id: IDS.keyTinyLimit,
          team: IDS.teamDefault,
          key,
          status: (await this.getDbKeyStatus(IDS.keyTinyLimit)) ?? 'active',
          keySpendingLimitDaily: 0.01,
          teamSpendingLimitMonthly: 4,
          providers: [this.allProviders[0]!],
        }
      default:
        return null
    }
  }

  async disableKey(id: number, reason: string, newStatus: string, expirationTtl?: number): Promise<void> {
    await super.disableKey(id, reason, newStatus, expirationTtl)
    this.disableEvents.push({ id, reason, newStatus, expirationTtl })
  }
}
