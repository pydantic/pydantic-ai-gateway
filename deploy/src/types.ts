import { OtelSettings, ProviderProxy } from '@pydantic/ai-gateway'

export interface Config<ProviderKey extends string = string> {
  /** @param team: record keys are the team ids */
  teams: Record<number, Team>
  providers: Record<ProviderKey, ProviderProxy>
  apiKeys: Record<string, ApiKey<ProviderKey>>
}

export type OtelExporterOtlpProtocol = 'http/json' | 'http/protobuf'

export interface Team {
  /** @name: human readable name for the team */
  name: string
  /** @otel: otel settings for sending proxy telemetry to Logfire or other OTel service, for all users in the team */
  otel?: OtelSettings
  /** @users: record keys are the user ids */
  users: Record<number, User>
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
  /** @param id: unique numeric id of the API key */
  id: number
  /** @param team: id of the team the API key belongs to */
  team: number
  /** @param user: optional id of the user the API key belongs to */
  user?: number
  expires?: number
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
  spendingLimitTotal?: number
  providers: ProviderKey[] | '__all__'
}
