import { env } from 'cloudflare:workers'
import type { Config } from '@deploy/types'

// can be whatever you want, just used to make linking apiKeys to providers typesafe.
type ProviderKeys = 'a' | 'b' | 'c' | 'd'

// teams, users and keys must have numeric keys, using constants here to make it easier to understand
// of course, keys must be unique within a type (e.g. team ids must be unique) but users and teams can have the same id
// we just use different ids here for clarity
const TEAM_DEFAULT_ID = 1
const USER_SAMUEL_ID = 2
const MAIN_API_KEY_ID = 3

export const config: Config<ProviderKeys> = {
  teams: {
    [TEAM_DEFAULT_ID]: {
      name: 'default',
      otel: {
        // For sending proxy telemetry to Logfire or other OTel service, generate at logfire.pydantic.dev
        writeToken: 'pylf_...',
      },
      // users in this team
      users: {
        [USER_SAMUEL_ID]: {
          name: 'Samuel',
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
    // you would use this provider by using the model id `gateway:openai-chat/gpt-5` in Pydantic AI
    a: {
      // providerId decides on the logic used to process the request and response
      providerId: 'openai',
      // baseUrl decides what URL the request will be forwarded to
      baseUrl: 'https://api.openai.com/v1',
      // if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response
      injectCost: true,
      // credentials are used by the ProviderProxy to authenticate the forwarded request
      credentials: env.OPENAI_API_KEY,
    },
    b: { providerId: 'groq', baseUrl: 'https://api.groq.com', injectCost: true, credentials: env.GROQ_API_KEY },
    c: {
      providerId: 'google-vertex',
      // NOTE: you'll need to replace `{gcp-project-name}` to set your GCP project here
      baseUrl:
        'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/{gcp-project-name}/locations/us-central1/publishers/google/models',
      injectCost: true,
      credentials: env.GOOGLE_SERVICE_ACCOUNT_KEY,
    },
    d: {
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      injectCost: true,
      credentials: env.ANTHROPIC_API_KEY,
    },
  },
  // individual apiKeys
  apiKeys: {
    'REPLACE ME! run `npm run generate-api-key` and copy the output here': {
      id: MAIN_API_KEY_ID,
      // team is required
      team: TEAM_DEFAULT_ID,
      // user is optional
      user: USER_SAMUEL_ID,
      // providers is required and identifies which providers this apiKey is allowed to use
      providers: ['a', 'b'],
      // you can also optionally add limits to a single key here
      spendingLimitDaily: 1,
      spendingLimitWeekly: 5,
      spendingLimitMonthly: 10,
      // these limits include an extra limit `spendingLimitTotal` which is useful for temporary API keys
      spendingLimitTotal: 11,
    },
  },
}
