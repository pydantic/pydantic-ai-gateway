// Info about an API key for a particular provider returned by the DB during a request
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
  providers: ProviderProxy[]
  otelSettings: OtelSettings | null
}

export type ProviderID = 'groq' | 'openai' | 'google-vertex' | 'anthropic' | 'test'
// TODO | 'aws' | 'azure' | 'fireworks' | 'mistral' | 'cohere'

const providerIDs: Record<ProviderID, boolean> = {
  groq: true,
  openai: true,
  'google-vertex': true,
  anthropic: true,
  test: true,
}

export const providerIdArray = Object.keys(providerIDs).filter((id) => id !== 'test') as ProviderID[]

export function guardProviderID(id: string): id is ProviderID {
  return id in providerIDs
}

export interface ProviderProxy {
  /** @providerId: decides on the logic used to process the request and response */
  providerID: ProviderID
  /** @baseUrl: decides what URL the request will be forwarded to */
  baseUrl?: string
  /** @injectCost: if injectCost is True, the cost of request from genai-prices is injected in the usage object in the response */
  injectCost: boolean
  /** @credentials: credentials are used by the ProviderProxy to authenticate the forwarded request,
   * should be either an API key or service JSON for google vertex.
   */
  credentials: string
  /** @profile: profile let's you select a provider when multiple providers with the same ProviderID are allowed */
  profile?: string
  /** @priority: higher priority providers will be used first */
  priority?: number
}

export interface OtelSettings {
  /** @otelWriteToken: write token for sending proxy telemetry to Logfire or other OTel service,
   * generate at logfire.pydantic.dev
   */
  writeToken: string
  /** @otelBaseUrl: base URL to send opentelemetry data to,
   * if unset the baseUrl is derived from the Pydantic Logfire writeToken
   */
  baseUrl?: string
  /** @otelExporterProtocol: whether to send OTel data over protobuf or JSON, defaults to protobuf */
  exporterProtocol?: 'http/protobuf' | 'http/json'
}
