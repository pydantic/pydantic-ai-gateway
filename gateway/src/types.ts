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
  project: number
  org: number
  key: string
  status: KeyStatus
  // limits per apiKey - note the extra field since keys can have a total limit
  keySpendingLimitDaily?: number
  keySpendingLimitWeekly?: number
  keySpendingLimitMonthly?: number
  keySpendingLimitTotal?: number
  // limits per project
  projectSpendingLimitDaily?: number
  projectSpendingLimitWeekly?: number
  projectSpendingLimitMonthly?: number
  // limits per user
  userSpendingLimitDaily?: number
  userSpendingLimitWeekly?: number
  userSpendingLimitMonthly?: number
  providers: ProviderProxy[]
  otelSettings?: OtelSettings
}

export type ProviderID = 'groq' | 'openai' | 'google-vertex' | 'anthropic' | 'test' | 'bedrock'
// TODO | 'azure' | 'fireworks' | 'mistral' | 'cohere'

export type APIType = 'chat' | 'responses' | 'converse' | 'anthropic' | 'gemini' | 'groq' | 'test'

const apiTypes: Record<APIType, boolean> = {
  chat: true,
  responses: true,
  converse: true,
  anthropic: true,
  gemini: true,
  groq: true,
  test: true,
}

export const apiTypesArray = Object.keys(apiTypes) as APIType[]

export function guardAPIType(type: string): type is APIType {
  return type in apiTypes
}

export interface ProviderProxy {
  /** Decides on the logic used to process the request and response */
  providerId: ProviderID

  /** Decides what URL the request will be forwarded to */
  baseUrl: string

  /** If injectCost is True, the cost of request from genai-prices is injected in the usage object in the response */
  injectCost: boolean

  /** Credentials are used by the ProviderProxy to authenticate the forwarded request,
   * should be either an API key or service JSON for Google Vertex. */
  credentials: string

  /** Profile let's you select a provider when multiple providers with the same ProviderID are allowed */
  profile?: string

  /** Higher priority providers will be used first */
  priority?: number

  /** Weather to disable the key in case of error, if missing defaults to True. */
  disableKey?: boolean

  /** The APIs that the provider supports. Example: ['chat', 'responses'] */
  apiTypes: APIType[]

  /** A grouping of APIs that serve the same models.
   * @example: 'anthropic' would route the requests to Anthropic, Bedrock and Vertex AI. */
  routingGroup?: string

  /** Whether the provider is managed by the platform and not by the user. */
  isBuiltIn?: boolean
}

export interface OtelSettings {
  /** Write token for sending proxy telemetry to Logfire or other OTel service,
   * generate at logfire.pydantic.dev */
  writeToken: string

  /** Base URL to send opentelemetry data to,
   * if unset the baseUrl is derived from the Pydantic Logfire writeToken
   */
  baseUrl?: string

  /** Whether to send OTel data over protobuf or JSON, defaults to protobuf */
  exporterProtocol?: 'http/protobuf' | 'http/json'
}
