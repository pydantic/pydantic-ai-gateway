import { ProviderProxy } from '@pydantic/ai-gateway'

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
  /** @otelWriteToken: write token for sending proxy telemetry to Logfire or other OTel service, generate at logfire.pydantic.dev */
  otelWriteToken?: string
  /** @otelBaseUrl: base URL to send opentelemetry data to */
  otelBaseUrl?: string
  /** @otelExporterOtlpProtocol: whether to send otel over protobuf or JSON */
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

export interface ApiKey<ProviderKey extends string = string> {
  team: string
  user?: string
  expires?: number
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
  spendingLimitTotal?: number
  providers: ProviderKey[] | '__all__'
}
