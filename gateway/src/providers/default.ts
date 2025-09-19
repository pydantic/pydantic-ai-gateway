import { Usage, calcPrice, extractUsage, findProvider } from '@pydantic/genai-prices'
import * as logfire from '@pydantic/logfire-api'

import { GatewayEnv } from '..'
import { ModelAPI } from '../api'
import { GenAIAttributes, GenAiOtelEvent } from '../otel/attributes'
import { ApiKeyInfo, ProviderProxy } from '../types'

export interface ProxySuccess {
  requestModel?: string
  requestBody: string
  successStatus: number
  responseHeaders: Headers
  responseBody: string
  responseModel: string
  otelEvents?: GenAiOtelEvent[]
  otelAttributes?: GenAIAttributes
  usage: Usage
  cost: number
}

export interface ProxyInvalidRequest {
  error: string
  // if true we should disable the key immediately since it appears to be incurring cost we can't measure
  disableKey?: boolean
  requestModel?: string
}

export interface ProxyUnexpectedResponse {
  requestModel?: string
  requestBody: string
  unexpectedStatus: number
  responseHeaders: Headers
  responseBody: string
}

interface Prepare {
  requestBodyText: string
  requestBodyData: JsonData
  requestModel?: string
}

export type JsonData = object

interface ProcessResponse {
  responseBody: JsonData
  responseModel: string
  usage: Usage
  cost: number
}

export class DefaultProviderProxy {
  protected request: Request
  protected env: GatewayEnv
  protected apiKey: ApiKeyInfo
  protected providerProxy: ProviderProxy
  protected restOfPath: string
  protected defaultBaseUrl: string | null = null
  protected usageField: string | null = 'usage'

  constructor(
    request: Request,
    env: GatewayEnv,
    apiKey: ApiKeyInfo,
    providerProxy: ProviderProxy,
    restOfPath: string,
  ) {
    this.request = request
    this.env = env
    this.apiKey = apiKey
    this.providerProxy = providerProxy
    this.restOfPath = restOfPath
  }

  providerId(): string {
    return this.providerProxy.providerID
  }

  protected apiFlavor(): string | undefined {
    return undefined
  }

  protected modelAPI(): ModelAPI | undefined {
    return undefined
  }

  /**
   * Check that the model being used is supported.
   * In particular that we can accurately determine the token usage from the response.
   */
  protected check(): ProxyInvalidRequest | undefined {
    return undefined
  }

  protected method(): string {
    return this.request.method
  }

  protected url(): ProxyInvalidRequest | string {
    const baseUrl = this.providerProxy.baseUrl ?? this.defaultBaseUrl
    if (baseUrl) {
      return `${baseUrl}/${this.restOfPath}`
    } else {
      return { error: "Provider baseUrl is required unless you're using a known provider" }
    }
  }

  protected userAgent(): string {
    const userAgent = this.request.headers.get('user-agent')
    return `${String(userAgent)} via Pydantic AI Gateway ${this.env.githubSha.substring(0, 7)}, contact engineering@pydantic.dev`
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async requestHeaders(headers: Headers): Promise<void> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
  }

  protected async prepRequest(): Promise<Prepare | ProxyInvalidRequest> {
    const requestBodyText = await this.request.text()
    let requestBodyData: JsonData
    let requestModel: string | undefined
    try {
      requestBodyData = JSON.parse(requestBodyText) as JsonData
      if ('model' in requestBodyData) {
        requestModel = requestBodyData.model as string
      }
    } catch {
      return { error: 'invalid request JSON' }
    }
    if (!requestModel || typeof requestModel === 'string') {
      return { requestBodyText, requestBodyData, requestModel }
    } else {
      return { error: 'invalid request, "model" should be a string' }
    }
  }

  protected fetch(url: string, init: RequestInit): Promise<Response> {
    const { subFetch } = this.env
    return subFetch(url, init)
  }

  protected async extractUsage(response: Response): Promise<ProcessResponse | ProxyInvalidRequest> {
    const bodyText = await response.text()
    try {
      const responseBody = JSON.parse(bodyText) as unknown as JsonData
      const provider = findProvider({ providerId: this.providerId() })
      if (!provider) {
        return { error: 'invalid response JSON, provider not found' }
      }
      const [responseModel, usage] = extractUsage(provider, responseBody, this.apiFlavor())

      const price = calcPrice(usage, responseModel, { provider })
      if (price) {
        return { responseBody, responseModel, usage, cost: price.total_price }
      } else {
        return { error: 'Unable to calculate spend' }
      }
    } catch (error) {
      logfire.reportError('Error extracting usage from response', error as Error, { bodyText })
      return { error: 'invalid response, unable to extract usage' }
    }
  }

  protected responseHeaders(_headers: Headers): void {
    return undefined
  }

  protected injectCost(responseBody: JsonData, cost: number) {
    if (this.usageField && this.usageField in responseBody) {
      const usage = (responseBody as Record<string, unknown>)[this.usageField]
      if (isMapping(usage)) {
        usage.pydantic_ai_gateway = { cost_estimate: cost }
      }
    }
  }

  async dispatch(): Promise<ProxySuccess | ProxyInvalidRequest | ProxyUnexpectedResponse> {
    const checkResult = this.check()
    if (checkResult) {
      return checkResult
    }

    const method = this.method()
    const url = this.url()
    if (typeof url === 'object') {
      return url
    }

    const requestHeaders = new Headers(this.request.headers)
    requestHeaders.set('user-agent', this.userAgent())
    // authorization header was used by the gateway auth, it definitely should not be forwarded to the target api
    requestHeaders.delete('authorization')
    await this.requestHeaders(requestHeaders)

    const prepResult = await this.prepRequest()
    if ('error' in prepResult) {
      return prepResult
    }
    const { requestBodyText, requestBodyData, requestModel } = prepResult
    const response = await this.fetch(url, { method, headers: requestHeaders, body: requestBodyText })

    if (!response.ok) {
      // CAUTION: can we be charged in any way for failed requests?
      const responseBody = await response.text()
      return {
        requestModel,
        requestBody: requestBodyText,
        unexpectedStatus: response.status,
        responseHeaders: response.headers,
        responseBody,
      }
    }

    const processResponse = await this.extractUsage(response)
    if ('error' in processResponse) {
      return { ...processResponse, disableKey: true, requestModel }
    }
    const { responseBody, usage, responseModel, cost } = processResponse

    // TODO we will want to remove some response headers, e.g. openai org
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('pydantic-ai-gateway-price-estimate', `${cost.toFixed(4)}USD`)
    this.responseHeaders(responseHeaders)

    if (this.providerProxy.injectCost) {
      this.injectCost(responseBody, cost)
    }

    const otelAttributes = safe(this.otelAttributes.bind(this))(requestBodyData, responseBody)

    return {
      responseModel,
      requestBody: requestBodyText,
      successStatus: response.status,
      responseHeaders,
      responseBody: JSON.stringify(responseBody),
      requestModel,
      otelAttributes,
      usage,
      cost,
    }
  }

  protected otelAttributes(requestBody: JsonData, responseBody: JsonData): GenAIAttributes {
    const modelAPI = this.modelAPI()
    if (!modelAPI) {
      return {}
    }
    return modelAPI.extractOtelAttributes(requestBody, responseBody)
  }
}

export function isMapping(v: unknown): v is Record<string, unknown> {
  return v !== null && !Array.isArray(v) && typeof v === 'object'
}

type Fn<Args extends unknown[], T> = (...args: Args) => T | undefined

export function safe<Args extends unknown[], T>(fn: Fn<Args, T>): Fn<Args, T> {
  return (...args: Args): T | undefined => {
    try {
      return fn(...args)
    } catch (error) {
      console.warn(`Error in ${fn.name}`, error)
      logfire.reportError(`Error in ${fn.name}`, error as Error, { args })
      return undefined
    }
  }
}
