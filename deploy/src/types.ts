import { ProviderProxy } from '@pydantic/ai-gateway'

export interface Config {
  org: string
  teams: Record<string, Team>
  providers: Record<string, ProviderProxy>
  apiKeys: Record<string, ApiKey>
}

export type OtelExporterOtlpProtocol = 'http/json' | 'http/protobuf'

export interface Team {
  name: string
  otelWriteToken?: string
  otelBaseUrl?: string
  otelExporterOtlpProtocol?: OtelExporterOtlpProtocol
  users: Record<string, User>
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
}

export interface User {
  name: string
  otelWriteToken?: string
  otelBaseUrl?: string
  otelExporterOtlpProtocol?: OtelExporterOtlpProtocol
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
