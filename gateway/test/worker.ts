import { gatewayFetch, GatewayEnv, LimitDbD1, KeysDb, ApiKeyInfo, ProviderProxy, SubFetch } from '@pydantic/ai-gateway'

export default {
  async fetch(request, env, ctx): Promise<Response> {
    return await gatewayFetch(request, ctx, buildGatewayEnv(env, fetch))
  },
} satisfies ExportedHandler<Env>

export function buildGatewayEnv(env: Env, subFetch: SubFetch): GatewayEnv {
  return {
    githubSha: 'test',
    keysDb: new TestKeysDB(),
    limitDb: new LimitDbD1(env.limitsDB),
    kv: env.KV,
    kvVersion: 'test',
    subFetch,
  }
}

class TestKeysDB extends KeysDb {
  async apiKeyAuth(key: string): Promise<ApiKeyInfo | null> {
    switch (key) {
      case 'healthy':
        return {
          id: 'healthy-id',
          user: 'user1',
          team: 'team1',
          org: 'org1',
          key,
          status: 'active',
          // key limits
          keySpendingLimitDaily: 1,
          keySpendingLimitWeekly: null,
          keySpendingLimitMonthly: null,
          keySpendingLimitTotal: 2,
          // user limits
          userSpendingLimitDaily: null,
          userSpendingLimitWeekly: 3,
          userSpendingLimitMonthly: null,
          // team limits
          teamSpendingLimitDaily: null,
          teamSpendingLimitWeekly: null,
          teamSpendingLimitMonthly: 4,
          providers: allProviders,
          otelSettings: {
            writeToken: 'write-token',
            baseUrl: 'https://logfire.pydantic.dev',
            exporterProtocol: 'http/json',
          },
        }
      default:
        return null
    }
  }

  async disableKey(_id: string, _reason: string): Promise<void> {
    // do nothing
  }
}

const allProviders: ProviderProxy[] = [
  {
    // baseUrl decides what URL the request will be forwarded to
    baseUrl: 'http://localhost:8005/openai',
    // providerId decides on the logic used to process the request and response
    providerID: 'openai',
    // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
    injectCost: true,
    // credentials are used by the ProviderProxy to authenticate the forwarded request
    credentials: 'env.OPENAI_API_KEY',
  },
  {
    baseUrl: 'http://localhost:8005/groq',
    providerID: 'groq',
    injectCost: true,
    credentials: 'env.GROQ_API_KEY',
  },
  {
    baseUrl: 'http://localhost:8005/anthropic',
    providerID: 'anthropic',
    injectCost: true,
    credentials: 'env.ANTHROPIC_API_KEY',
  },
  {
    baseUrl: 'http://test.example.com/test',
    providerID: 'test',
    injectCost: true,
    credentials: 'test',
  },
]
