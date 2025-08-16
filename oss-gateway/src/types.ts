import { Team, ProviderProxy, ApiKey } from '@pydantic/ai-gateway'

export interface Config {
  org: string
  teams: Team[]
  providers: ProviderProxy[]
  apiKeys: ApiKey[]
}
