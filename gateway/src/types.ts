export type SubFetch = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type KeyStatus =
  | 'active' // when the key is active
  | 'expired' // when the key expires
  | 'limit-exceeded' // when the key exceeds the limits
  | 'disabled' // when the user sets in the UI
  | 'blocked' // when we got a valid response that we couldn't calculate the cost for

// Info about an API key for a particular provider returned by the DB during a request
export interface ApiKeyInfo<ProviderKey extends string = string> {
  id: number
  user?: number
  project: number
  org: string
  // can be used however you like in rate limiter
  orgLimit?: number
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
  providers: (ProviderProxy & { key: ProviderKey })[]
  // TODO(DavidM): Eventually, make the priority _required_. Not sure if weight should be required or not
  // higher priority are preferred; if missing, use the negative index of the item (i.e., 0, then -1, then -2, etc.)
  // among values with same priority, use weight for randomized load balancing; if missing, treat as 1
  routingGroups: Record<string, { key: ProviderKey; priority?: number; weight?: number }[]>
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

export const providerIdsArray = Object.keys(providerIds) as ProviderID[]

export function guardProviderID(id: string): id is ProviderID {
  return id in providerIds
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

  /** Whether to disable the key in case of error, if missing defaults to True. */
  disableKey?: boolean

  /** Whether the provider is managed by the platform and not by the user. */
  isBuiltIn?: boolean

  // TODO(DavidM): Use or remove this
  // /** Regex-based model name remappings specific to this provider.
  //  * If present, each searchValue is tried in sequence until hitting a match according to the `string.match` method,
  //  * at which point we break out of the loop and apply the replaceValue using the JavaScript `string.replace` method.
  //  * If there is no match, the value is not modified. */
  // modelNameReplacements?: { searchValue: string; replaceValue: string }[]
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
