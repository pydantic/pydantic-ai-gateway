import {
  calcPrice,
  extractUsage,
  findProvider,
  type Usage,
  type Provider as UsageProvider,
} from '@pydantic/genai-prices'
import * as logfire from '@pydantic/logfire-api'
import { createParser, type EventSourceMessage } from 'eventsource-parser'

import type { GatewayOptions } from '..'
import type { ModelAPI } from '../api'
import type { GenAIAttributes } from '../otel/attributes'
import type { ApiKeyInfo, ProviderProxy } from '../types'
import { runAfter } from '../utils'

export interface ProxySuccess {
  requestModel?: string
  requestBody: string
  successStatus: number
  responseHeaders: Headers
  responseBody: string
  responseModel: string
  otelAttributes?: GenAIAttributes
  usage: Usage
  cost: number
}

export interface ProxyWhitelistedEndpoint {
  requestBody: string
  httpStatusCode: number
  responseHeaders: Headers
  responseBody: string
}

export interface ProxyStreamingSuccess {
  requestModel?: string
  requestBody: string
  successStatus: number
  responseHeaders: Headers
  responseStream: ReadableStream
  otelAttributes?: GenAIAttributes
  waitCompletion: Promise<void>
  // In case we get to the end of the response, and we are unable to calculate the cost, we need to know if we can disable the key.
  disableKey?: boolean
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

export type Next = (
  proxy: DefaultProviderProxy,
) => Promise<
  ProxyStreamingSuccess | ProxySuccess | ProxyInvalidRequest | ProxyUnexpectedResponse | ProxyWhitelistedEndpoint
>

export interface Middleware {
  dispatch(next: Next): Next
}

export interface ProviderOptions {
  request: Request
  gatewayOptions: GatewayOptions
  apiKeyInfo: ApiKeyInfo
  providerProxy: ProviderProxy
  restOfPath: string
  ctx: ExecutionContext
  middlewares?: Middleware[]
}

export class DefaultProviderProxy {
  readonly request: Request
  readonly options: GatewayOptions
  readonly ctx: ExecutionContext
  protected providerProxy: ProviderProxy
  protected restOfPath: string
  protected defaultBaseUrl: string | null = null
  protected usageField: string | null = 'usage'
  protected middlewares: Middleware[]

  // NOTE: Those fields are used only for streaming responses for the time being.
  protected usage: Usage | null = null
  protected responseModel: string | null = null

  readonly apiKeyInfo: ApiKeyInfo

  constructor(options: ProviderOptions) {
    this.request = options.request
    this.options = options.gatewayOptions
    this.ctx = options.ctx
    this.apiKeyInfo = options.apiKeyInfo
    this.providerProxy = options.providerProxy
    this.restOfPath = options.restOfPath
    this.middlewares = options.middlewares ?? []
  }

  /**
   * Run a promise after the dispatch is complete.
   * This is useful for running code that should be executed after the response is sent.
   * @param name - The name of the function to run. It's used for logging and error reporting.
   * @param promise - The promise to run.
   */
  runAfter(name: string, promise: Promise<unknown>) {
    runAfter(this.ctx, name, promise)
  }

  cost(): number | undefined {
    const provider = this.usageProvider()
    const usage = this.usage
    const responseModel = this.responseModel

    if (!provider || !usage || !responseModel) {
      logfire.warning('Unable to calculate cost', { provider, usage, responseModel })
      return undefined
    }

    const price = calcPrice(usage, responseModel, { provider })
    if (price) {
      return price.total_price
    } else {
      return undefined
    }
  }

  providerId(): string {
    return this.providerProxy.providerId
  }

  disableKey(): boolean {
    return this.providerProxy.disableKey ?? true
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

  protected usageProvider(): UsageProvider | undefined {
    return findProvider({ providerId: this.providerId() })
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
    return `${String(userAgent)} via Pydantic AI Gateway ${this.options.githubSha.substring(0, 7)}, contact engineering@pydantic.dev`
  }

  // biome-ignore lint/suspicious/useAwait: required by google auth
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
    const { subFetch } = this.options
    return subFetch(url, init)
  }

  protected async extractUsage(response: Response): Promise<ProcessResponse | ProxyInvalidRequest> {
    const bodyText = await response.text()
    try {
      const responseBody = JSON.parse(bodyText) as unknown as JsonData
      const provider = this.usageProvider()
      // TODO(Marcelo): Check if the next line is ever reached. I think `usageProvider` is always a valid provider at this point.
      if (!provider) {
        return { error: 'invalid response JSON, provider not found' }
      }
      let { model: responseModel, usage } = extractUsage(provider, responseBody, this.apiFlavor())
      if (!responseModel) {
        // If the response model cannot be extracted from the `responseBody`, we try to infer from the URL.
        responseModel = this.inferResponseModel()
        if (!responseModel) {
          return { error: 'Unable to infer response model' }
        }
      }
      const price = calcPrice(usage, responseModel, { provider })
      if (price) {
        return { responseBody, responseModel, usage, cost: price.total_price }
      } else {
        logfire.error('Unable to calculate spend', { responseModel, usage, provider })
        return { error: 'Unable to calculate spend' }
      }
    } catch (error) {
      logfire.reportError('Error extracting usage from response', error as Error, { bodyText })
      return { error: 'invalid response, unable to extract usage' }
    }
  }

  protected inferResponseModel(): string | null {
    return null
  }

  protected responseHeaders(headers: Headers): Headers {
    return new Headers(headers)
  }

  protected injectCost(responseBody: JsonData, cost: number) {
    if (this.usageField && this.usageField in responseBody) {
      const usage = (responseBody as Record<string, unknown>)[this.usageField]
      if (isMapping(usage)) {
        usage.pydantic_ai_gateway = { cost_estimate: cost }
      }
    }
  }

  async dispatch(): Promise<
    ProxyStreamingSuccess | ProxySuccess | ProxyInvalidRequest | ProxyUnexpectedResponse | ProxyWhitelistedEndpoint
  > {
    const layers = this.middlewares.reduceRight(
      (next, middleware) => middleware.dispatch(next),
      (proxy: DefaultProviderProxy) => proxy.dispatchInner(),
    )
    return await layers(this)
  }

  protected async dispatchInner(): Promise<
    ProxyStreamingSuccess | ProxySuccess | ProxyInvalidRequest | ProxyUnexpectedResponse | ProxyWhitelistedEndpoint
  > {
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

    if (this.isWhitelistedEndpoint()) {
      return {
        requestBody: requestBodyText,
        httpStatusCode: response.status,
        responseHeaders: response.headers,
        responseBody: await response.text(),
      }
    }

    // Each provider should be able to modify the response headers, e.g. remove openai org
    const responseHeaders = this.responseHeaders(response.headers)

    if (!response.ok) {
      // CAUTION: can we be charged in any way for failed requests?
      const responseBody = await response.text()
      return {
        requestModel,
        requestBody: requestBodyText,
        unexpectedStatus: response.status,
        responseHeaders,
        responseBody,
      }
    }

    const isStreaming =
      responseHeaders.get('content-type')?.startsWith('text/event-stream') ||
      ('stream' in requestBodyData && requestBodyData.stream === true)
    if (isStreaming) {
      return this.dispatchStreaming(prepResult, response, responseHeaders)
    }

    const processResponse = await this.extractUsage(response)
    if ('error' in processResponse) {
      return { ...processResponse, disableKey: this.disableKey(), requestModel }
    }
    const { responseBody, usage, responseModel, cost } = processResponse

    responseHeaders.set('pydantic-ai-gateway-price-estimate', `${cost.toFixed(4)}USD`)

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

  protected dispatchStreaming(
    { requestBodyText, requestModel }: Prepare,
    response: Response,
    responseHeaders: Headers,
  ): ProxyStreamingSuccess | ProxyInvalidRequest | ProxyUnexpectedResponse {
    const textEncoder = new TextDecoder()
    const sse_parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        // This is how chat completions streaming responses end.
        if (event.data === '[DONE]') return
        try {
          const data = JSON.parse(event.data)
          this.handleData(data)
        } catch (error) {
          logfire.reportError('Error handling data', error as Error)
        }
      },
    })

    if (!response.body) {
      return { requestModel, error: 'No response body' }
    }

    const provider = this.usageProvider()
    if (!provider) {
      return { error: 'No usage provider found' }
    }

    // Tee the source stream so we can both pipe it through the transform and track completion
    const [streamForTransform, streamForTracking] = response.body.tee()

    const { readable: responseStream, writable } = new TransformStream({
      transform(chunk, controller) {
        sse_parser.feed(textEncoder.decode(chunk))
        controller.enqueue(chunk)
      },
    })

    // Pipe the first tee through the transform (this is what gets sent to the client)
    streamForTransform.pipeTo(writable)

    // Track when the second tee is fully consumed (which happens when the transform completes)
    const waitCompletion = streamForTracking.pipeTo(new WritableStream())

    return {
      requestModel,
      requestBody: requestBodyText,
      successStatus: response.status,
      responseHeaders,
      responseStream,
      waitCompletion,
    }
  }

  protected handleData(_data: JsonData): void {}

  protected isWhitelistedEndpoint(): boolean {
    return false
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
