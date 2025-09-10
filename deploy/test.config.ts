import { env } from 'cloudflare:workers'
import type { Config } from '@deploy/types'

export const CONFIG_VERSION = '4'
type ProviderKeys = 'openai'

export const config: Config<ProviderKeys> = {
  // the name of the organization, doesn't matter in this case
  org: 'my-org',
  teams: {
    default: {
      name: 'default',
      otel: { writeToken: 'write-token', exporterProtocol: 'http/json' },
      // users in this team
      users: {
        testberto: {
          name: 'testberto',
          // each user can have their own spending limits, or these can be omitted
          spendingLimitDaily: 1,
          spendingLimitWeekly: 5,
          spendingLimitMonthly: 10,
        },
      },
      /// similarly team limits are optional
      spendingLimitDaily: 10,
      spendingLimitWeekly: 50,
      spendingLimitMonthly: 100,
    },
  },
  // providers
  providers: {
    // the key is the slug used to identify the provider in the incoming request
    openai: {
      // baseUrl decides what URL the request will be forwarded to
      baseUrl: 'http://localhost:8005',
      // providerId decides on the logic used to process the request and response
      providerID: 'openai-chat',
      // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
      injectCost: true,
      // credentials are used by the ProviderProxy to authenticate the forwarded request
      credentials: env.OPENAI_API_KEY,
    },
    // groq: {
    //     baseUrl: 'https://api.groq.com',
    //     providerId: 'groq',
    //     injectCost: true,
    //     credentials: env.GROQ_API_KEY,
    // },
    // google: {
    //     baseUrl:
    //         'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/{gcp-project-name}/locations/us-central1/publishers/google/models',
    //     providerId: 'google',
    //     injectCost: true,
    //     credentials: env.GOOGLE_SERVICE_ACCOUNT_KEY,
    // },
  },
  // individual apiKeys
  apiKeys: {
    'o-QBrunFudqD99879C5jkFZgZrueCLlCJGSMAbzFGFY': {
      // team is required
      team: 'default',
      // user is optional
      user: 'testberto',
      // providers is required and identifies which providers this apiKey is allowed to use
      providers: ['openai'],
      // you can also optionally add limits to a single key here
      spendingLimitDaily: 1,
      spendingLimitWeekly: 5,
      spendingLimitMonthly: 10,
      // these limits include an extra limit `spendingLimitTotal` which is useful for temporary API keys
      spendingLimitTotal: 11,
    },
  },
}
