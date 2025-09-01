import { ProviderProxy } from '@pydantic/ai-gateway'

export interface Config {
  org: string
  teams: Record<string, Team>
  providers: Record<string, ProviderProxy>
  apiKeys: Record<string, ApiKey>
}

export interface Team {
  name: string
  otelWriteToken?: string
  otelBaseUrl?: string
  users: Record<string, User>
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
}

export interface User {
  name: string
  otelWriteToken?: string
  otelBaseUrl?: string
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
}

export interface ApiKey {
  team: string
  user?: string
  expires?: number
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
  spendingLimitTotal?: number
  providers: string[]
}
