import {
  type ApiKeyInfo,
  type GatewayOptions,
  gatewayFetch,
  type KeyStatus,
  KeysDbD1,
  LimitDbD1,
  type ProviderProxy,
  type SubFetch,
} from '@pydantic/ai-gateway'
import type { Middleware } from '../src/providers/default'

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    return await gatewayFetch(request, url, ctx, buildGatewayEnv(env, [], fetch))
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
  proxyPrefixLength?: number,
  proxyMiddlewares?: Middleware[],
): GatewayOptions {
  return {
    githubSha: 'test',
    keysDb: new TestKeysDB(env, disableEvents),
    limitDb: new LimitDbD1(env.limitsDB),
    kv: env.KV,
    kvVersion: 'test',
    subFetch,
    proxyPrefixLength,
    proxyMiddlewares,
  }
}

export namespace IDS {
  export const orgDefault = 1
  export const projectDefault = 2
  export const userDefault = 3
  export const keyHealthy = 4
  export const keyDisabled = 5
  export const keyTinyLimit = 6
}

class TestKeysDB extends KeysDbD1 {
  allProviders: ProviderProxy[]
  disableEvents: DisableEvent[]

  constructor(env: Env, disableEvents: DisableEvent[]) {
    super(env.limitsDB)
    this.disableEvents = disableEvents
    this.allProviders = [
      {
        baseUrl: 'http://test.example.com/test',
        providerId: 'test',
        injectCost: true,
        credentials: 'test',
        apiTypes: ['test'],
      },
      {
        // baseUrl decides what URL the request will be forwarded to
        baseUrl: 'http://localhost:8005/openai',
        // providerId decides on the logic used to process the request and response
        providerId: 'openai',
        // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
        injectCost: true,
        // credentials are used by the ProviderProxy to authenticate the forwarded request
        credentials: env.OPENAI_API_KEY,
        apiTypes: ['chat'],
      },
      {
        baseUrl: 'http://localhost:8005/groq',
        providerId: 'groq',
        injectCost: true,
        credentials: env.GROQ_API_KEY,
        apiTypes: ['groq'],
      },
      {
        baseUrl: 'http://localhost:8005/anthropic',
        providerId: 'anthropic',
        injectCost: true,
        credentials: env.ANTHROPIC_API_KEY,
        apiTypes: ['anthropic'],
      },
      {
        baseUrl: 'http://localhost:8005/bedrock',
        providerId: 'bedrock',
        injectCost: true,
        credentials: env.AWS_BEARER_TOKEN_BEDROCK,
        apiTypes: ['anthropic', 'converse'],
      },
    ]
  }

  async getApiKey(key: string): Promise<ApiKeyInfo | null> {
    switch (key) {
      case 'healthy':
        return {
          id: IDS.keyHealthy,
          user: IDS.userDefault,
          project: IDS.projectDefault,
          org: IDS.orgDefault,
          key,
          status: (await this.getDbKeyStatus(IDS.keyHealthy)) ?? 'active',
          // key limits
          keySpendingLimitDaily: 1,
          keySpendingLimitTotal: 2,
          // user limits
          userSpendingLimitWeekly: 3,
          // project limits
          projectSpendingLimitMonthly: 4,
          providers: this.allProviders,
          otelSettings: {
            writeToken: 'write-token',
            baseUrl: 'https://logfire.pydantic.dev',
            exporterProtocol: 'http/json',
          },
        }
      case 'disabled':
        return {
          id: IDS.keyDisabled,
          project: IDS.projectDefault,
          org: IDS.orgDefault,
          key,
          status: 'disabled',
          providers: this.allProviders,
        }
      case 'tiny-limit':
        return {
          id: IDS.keyTinyLimit,
          project: IDS.projectDefault,
          org: IDS.orgDefault,
          key,
          status: (await this.getDbKeyStatus(IDS.keyTinyLimit)) ?? 'active',
          keySpendingLimitDaily: 0.01,
          projectSpendingLimitMonthly: 4,
          providers: [this.allProviders[0]!],
        }
      default:
        return null
    }
  }

  async disableKey(id: number, reason: string, newStatus: KeyStatus, expirationTtl?: number): Promise<void> {
    await super.disableKey(id, reason, newStatus, expirationTtl)
    this.disableEvents.push({ id, reason, newStatus, expirationTtl })
  }
}
