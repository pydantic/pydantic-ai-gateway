import {
  gatewayFetch,
  GatewayEnv,
  LimitDbD1,
  KeysDbD1,
  ApiKeyInfo,
  ProviderProxy,
  SubFetch,
} from '@pydantic/ai-gateway'

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return await gatewayFetch(request, ctx, buildGatewayEnv(env, [], fetch))
  },
} satisfies ExportedHandler<Env>

export interface DisableEvent {
  id: string
  reason: string
  newStatus: string
  expirationTtl?: number
}

export function buildGatewayEnv(env: Env, disableEvents: DisableEvent[], subFetch: SubFetch): GatewayEnv {
  return {
    githubSha: 'test',
    keysDb: new TestKeysDB(env, disableEvents),
    limitDb: new LimitDbD1(env.limitsDB),
    kv: env.KV,
    kvVersion: 'test',
    subFetch,
  }
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
        providerID: 'test',
        injectCost: true,
        credentials: 'test',
      },
      {
        // baseUrl decides what URL the request will be forwarded to
        baseUrl: 'http://localhost:8005/openai',
        // providerId decides on the logic used to process the request and response
        providerID: 'openai',
        // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
        injectCost: true,
        // credentials are used by the ProviderProxy to authenticate the forwarded request
        credentials: env.OPENAI_API_KEY,
      },
      {
        baseUrl: 'http://localhost:8005/groq',
        providerID: 'groq',
        injectCost: true,
        credentials: env.GROQ_API_KEY,
      },
      {
        baseUrl: 'http://localhost:8005/anthropic',
        providerID: 'anthropic',
        injectCost: true,
        credentials: env.ANTHROPIC_API_KEY,
      },
    ]
  }

  async apiKeyAuth(key: string): Promise<ApiKeyInfo | null> {
    switch (key) {
      case 'healthy':
        return {
          id: 'healthy-id',
          user: 'user1',
          team: 'team1',
          org: 'org1',
          key,
          status: (await this.getDbKeyStatus('healthy-id')) ?? 'active',
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
        return {
          id: 'disabled-id',
          user: null,
          team: 'team1',
          org: 'org1',
          key,
          status: 'disabled',
          providers: this.allProviders,
          otelSettings: null,
        }
      case 'tiny-limit':
        return {
          id: 'tiny-limit-id',
          user: null,
          team: 'team1',
          org: 'org1',
          key,
          status: (await this.getDbKeyStatus('tiny-limit-id')) ?? 'active',
          keySpendingLimitDaily: 0.01,
          teamSpendingLimitMonthly: 4,
          providers: [this.allProviders[0]!],
          otelSettings: null,
        }
      default:
        return null
    }
  }

  async disableKey(id: string, reason: string, newStatus: string, expirationTtl?: number): Promise<void> {
    await super.disableKey(id, reason, newStatus, expirationTtl)
    this.disableEvents.push({ id, reason, newStatus, expirationTtl })
  }
}
