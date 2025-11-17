import type { OtelSettings, ProviderProxy } from '@pydantic/ai-gateway'

export interface Config<ProviderKey extends string = string> {
  /** @param project: record keys are the project ids */
  projects: Record<number, Project>
  routingGroups?: Record<string, { key: ProviderKey; priority?: number; weight?: number }[]>
  providers: Record<ProviderKey, ProviderProxy>
  apiKeys: Record<string, ApiKey<ProviderKey>>
}

export type OtelExporterOtlpProtocol = 'http/json' | 'http/protobuf'

export interface Project {
  /** @name: human readable name for the project */
  name: string
  /** @otel: otel settings for sending proxy telemetry to Logfire or other OTel service, for all users in the project */
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
  /** @param project: id of the project the API key belongs to */
  project: number
  /** @param user: optional id of the user the API key belongs to */
  user?: number
  expires?: number
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
  spendingLimitTotal?: number
  providers: ProviderKey[] | '__all__'
}
