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
import type { BaseAPI } from '../api/base'
import type { OtelSpan } from '../otel'
import { attributesFromRequest, attributesFromResponse, type GenAIAttributes } from '../otel/attributes'
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
  response: Response
}

export interface ProxyStreamingSuccess {
  requestModel?: string
  requestBody: string
  successStatus: number
  responseHeaders: Headers
  responseStream: ReadableStream
  otelAttributes?: GenAIAttributes
  onStreamComplete: Promise<{ cost?: number } | { error: Error }>
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
  otelSpan: OtelSpan
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
  protected otelSpan: OtelSpan

  // NOTE: Those fields are used only for streaming responses for the time being.
  protected usage: Usage | null = null
  protected responseModel: string | null = null
  cost: number | undefined = undefined

  readonly apiKeyInfo: ApiKeyInfo

  constructor(options: ProviderOptions) {
    this.request = options.request
    this.options = options.gatewayOptions
    this.ctx = options.ctx
    this.apiKeyInfo = options.apiKeyInfo
    this.providerProxy = options.providerProxy
    this.restOfPath = options.restOfPath
    this.middlewares = options.middlewares ?? []
    this.otelSpan = options.otelSpan
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

  providerId(): string {
    return this.providerProxy.providerId
  }

  disableKey(): boolean {
    return this.providerProxy.disableKey ?? true
  }

  protected apiFlavor(): string | undefined {
    return undefined
  }

  protected modelAPI(): ModelAPI {
    throw new Error('modelAPI must be implemented by the subclass')
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
      this.otelSpan.end(
        `${this.request.method} ${this.restOfPath}`,
        {
          ...attributesFromRequest(this.request),
          ...attributesFromResponse(response),
          'http.request.body.text': requestBodyText,
        },
        { level: 'info' },
      )
      return { response }
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
    { requestBodyText, requestBodyData, requestModel }: Prepare,
    response: Response,
    responseHeaders: Headers,
  ): ProxyStreamingSuccess | ProxyInvalidRequest | ProxyUnexpectedResponse {
    if (!response.body) {
      return { requestModel, error: 'No response body' }
    }

    const provider = this.usageProvider()
    if (!provider) {
      return { error: 'No usage provider found' }
    }

    // Get ModelAPI instance
    const modelAPI = this.modelAPI()
    // @ts-expect-error: requestBodyData is a JsonData, but the `processRequest` receives the proper type.
    modelAPI.processRequest(requestBodyData)

    // IMPORTANT: Start consuming BOTH streams immediately to prevent tee() from buffering
    // The tee() requires both streams to be consumed concurrently, otherwise it will buffer

    // Tee stream: one for client, one for processing
    const [responseStream, processingStream] = response.body.tee()

    // Parse SSE events from processing stream
    const events = this.parseSSE(processingStream)

    // @ts-expect-error: TODO(Marcelo): Fix this type error.
    const extractionPromise = this.processChunks(modelAPI, events)

    // Track completion but don't wait for it before returning
    this.runAfter('extract-stream', extractionPromise)

    const onStreamComplete = extractionPromise
      .then((result) => {
        // TODO(Marcelo): I think we actually need to emit 2 spans: one for HTTP, and another for the LLM.
        this.otelSpan.end(
          `chat ${modelAPI.extractedRequest?.requestModel ?? 'streaming'}`,
          {
            ...modelAPI.toGenAiOtelAttributes(),
            ...attributesFromRequest(this.request),
            ...attributesFromResponse(response),
          },
          { level: 'info' },
        )

        return result
      })
      .catch() // Swallow errors, already logged

    return {
      requestModel,
      requestBody: requestBodyText,
      successStatus: response.status,
      responseHeaders,
      responseStream,
      onStreamComplete,
    }
  }

  private async processChunks<T>(
    modelAPI: BaseAPI<unknown, unknown, T>,
    events: AsyncIterable<T>,
  ): Promise<{ cost?: number } | { error: Error }> {
    for await (const chunk of events) {
      modelAPI.processChunk(chunk)
    }

    const provider = this.usageProvider()
    const usage = modelAPI.extractedResponse.usage
    const responseModel = modelAPI.extractedResponse.responseModel

    if (!provider || !usage || !responseModel) {
      return { error: new Error(`Unable to calculate cost for model ${responseModel}`) }
    }

    const price = calcPrice(usage, responseModel, { provider })
    if (price) {
      return { cost: price.total_price }
    } else {
      return { error: new Error(`Unable to calculate cost for model ${responseModel} and provider ${provider.name}`) }
    }
  }

  private async *parseSSE(stream: ReadableStream<Uint8Array>): AsyncIterable<JsonData> {
    const decoder = new TextDecoder()
    const events: JsonData[] = []

    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === '[DONE]') return
        try {
          events.push(JSON.parse(event.data))
        } catch (error) {
          logfire.reportError('Error parsing SSE event', error as Error)
        }
      },
    })

    for await (const chunk of stream) {
      parser.feed(decoder.decode(chunk, { stream: true }))

      // Yield all parsed events from this chunk
      while (events.length > 0) {
        yield events.shift()!
      }
    }
  }

  protected isWhitelistedEndpoint(): boolean {
    return false
  }

  protected otelAttributes(requestBody: JsonData, responseBody: JsonData): GenAIAttributes {
    const modelAPI = this.modelAPI()
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
