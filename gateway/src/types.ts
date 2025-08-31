// Info about an API key returned by the DB during a request
export interface ApiKeyInfo {
  id: string
  user: string | null
  team: string
  org: string
  key: string
  // TODO this should be status: 'active' | 'expired' | 'limit-exceeded' | 'disabled'
  active: boolean
  // limits per apiKey - note the extra field since keys can have a total limit
  keySpendingLimitDaily: number | null
  keySpendingLimitWeekly: number | null
  keySpendingLimitMonthly: number | null
  keySpendingLimitTotal: number | null
  // limits per team
  teamSpendingLimitDaily: number | null
  teamSpendingLimitWeekly: number | null
  teamSpendingLimitMonthly: number | null
  // limits per user
  userSpendingLimitDaily: number | null
  userSpendingLimitWeekly: number | null
  userSpendingLimitMonthly: number | null
  providers: Record<string, ProviderProxy>
  otelSettings: OtelSettings | null
}

export type ProviderID =
  | 'avian'
  | 'groq'
  | 'openai'
  | 'novita'
  | 'fireworks'
  | 'deepseek'
  | 'mistral'
  | 'x-ai'
  | 'google'
  | 'perplexity'
  | 'aws'
  | 'together'
  | 'anthropic'
  | 'azure'
  | 'cohere'
  | 'openrouter'

export interface ProviderProxy {
  name: string
  baseUrl?: string
  providerId: ProviderID
  injectCost: boolean
  credentials: string
}

export interface OtelSettings {
  // if writeToken is unset, no authorization header is set
  writeToken?: string
  // if unset the baseUrl is derived from the Pydantic Logfire writeToken
  baseUrl?: string
}
