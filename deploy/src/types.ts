import { ProviderProxy, OtelSettings } from '@pydantic/ai-gateway'

export interface Config<ProviderKey extends string = string> {
  org: string
  teams: Record<string, Team>
  providers: Record<ProviderKey, ProviderProxy>
  apiKeys: Record<string, ApiKey<ProviderKey>>
}

export type OtelExporterOtlpProtocol = 'http/json' | 'http/protobuf'

export interface Team {
  /** @name: human readable name for the team */
  name: string
  /** @otel: otel settings for sending proxy telemetry to Logfire or other OTel service, for all users in the team */
  otel?: OtelSettings
  users: Record<string, User>
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
}

export interface User {
  name: string
  /** @otel: otel settings for sending proxy telemetry to Logfire or other OTel service, for this user */
  otel?: OtelSettings
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
}

export interface ApiKey<ProviderKey extends string> {
  /** @param key: if unset, a hash of the API key itself is used */
  id?: string
  team: string
  user?: string
  expires?: number
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
  spendingLimitTotal?: number
  providers: ProviderKey[] | '__all__'
}
