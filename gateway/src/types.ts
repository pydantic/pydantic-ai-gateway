export type SubFetch = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type KeyStatus =
  | 'active' // when the key is active
  | 'expired' // when the key expires
  | 'limit-exceeded' // when the key exceeds the limits
  | 'disabled' // when the user sets in the UI
  | 'blocked' // when we got a valid response that we couldn't calculate the cost for

// Info about an API key for a particular provider returned by the DB during a request
export interface ApiKeyInfo {
  id: number
  user?: number
  team: number
  key: string
  status: KeyStatus
  // limits per apiKey - note the extra field since keys can have a total limit
  keySpendingLimitDaily?: number
  keySpendingLimitWeekly?: number
  keySpendingLimitMonthly?: number
  keySpendingLimitTotal?: number
  // limits per team
  teamSpendingLimitDaily?: number
  teamSpendingLimitWeekly?: number
  teamSpendingLimitMonthly?: number
  // limits per user
  userSpendingLimitDaily?: number
  userSpendingLimitWeekly?: number
  userSpendingLimitMonthly?: number
  providers: ProviderProxy[]
  otelSettings?: OtelSettings
}

export type ProviderID = 'groq' | 'openai' | 'google-vertex' | 'anthropic' | 'test' | 'bedrock'
// TODO | 'azure' | 'fireworks' | 'mistral' | 'cohere'

const providerIds: Record<ProviderID, boolean> = {
  groq: true,
  openai: true,
  'google-vertex': true,
  anthropic: true,
  test: true,
  bedrock: true,
}

export const providerIdArray = Object.keys(providerIds).filter((id) => id !== 'test') as ProviderID[]

export function guardProviderID(id: string): id is ProviderID {
  return id in providerIds
}

export interface ProviderProxy {
  /** @providerId: decides on the logic used to process the request and response */
  providerId: ProviderID
  /** @baseUrl: decides what URL the request will be forwarded to */
  baseUrl: string
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
  /** @disableKey: weather to disable the key in case of error, if missing defaults to True. */
  disableKey?: boolean
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
