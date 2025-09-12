import { env } from 'cloudflare:workers'
import type { Config } from '@deploy/types'

type ProviderKeys = 'openai' | 'groq' | 'anthropic' | 'test'

export const config: Config<ProviderKeys> = {
  // the name of the organization, doesn't matter in this case
  org: 'my-org',
  teams: {
    default: {
      name: 'default',
      otel: { writeToken: 'write-token', baseUrl: 'https://logfire.pydantic.dev', exporterProtocol: 'http/json' },
      // users in this team
      users: {
        testberto: {
          name: 'testberto',
          // each user can have their own spending limits, or these can be omitted
          spendingLimitWeekly: 2,
        },
      },
      /// similarly team limits are optional
      spendingLimitDaily: 1,
    },
  },
  // providers
  providers: {
    // the key is the slug used to identify the provider in the incoming request
    openai: {
      // baseUrl decides what URL the request will be forwarded to
      baseUrl: 'http://localhost:8005/openai',
      // providerId decides on the logic used to process the request and response
      providerID: 'openai',
      // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
      injectCost: true,
      // credentials are used by the ProviderProxy to authenticate the forwarded request
      credentials: env.OPENAI_API_KEY,
    },
    groq: {
      baseUrl: 'http://localhost:8005/groq',
      providerID: 'groq',
      injectCost: true,
      credentials: env.GROQ_API_KEY,
    },
    // google: {
    //     baseUrl:
    //         'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/{gcp-project-name}/locations/us-central1/publishers/google/models',
    //     providerId: 'google',
    //     injectCost: true,
    //     credentials: env.GOOGLE_SERVICE_ACCOUNT_KEY,
    // },
    anthropic: {
      baseUrl: 'http://localhost:8005/anthropic',
      providerID: 'anthropic',
      injectCost: true,
      credentials: env.ANTHROPIC_API_KEY,
    },
    test: {
      baseUrl: 'http://test.example.com/test',
      providerID: 'test',
      injectCost: true,
      credentials: 'test',
    },
  },
  // individual apiKeys
  apiKeys: {
    'healthy-key': {
      // team is required
      team: 'default',
      user: 'testberto',
      providers: ['openai', 'groq', 'anthropic', 'test'],
      spendingLimitMonthly: 3,
      spendingLimitTotal: 4,
    },
    'low-limit-key': {
      team: 'default',
      providers: '__all__',
      spendingLimitDaily: 0.01,
    },
  },
}
