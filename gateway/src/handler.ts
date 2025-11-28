import {
  calcPrice,
  extractUsage,
  findProvider,
  type Usage,
  type Provider as UsageProvider,
} from '@pydantic/genai-prices'
import { EventStreamCodec } from '@smithy/eventstream-codec'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import logfire from 'logfire'
import { match } from 'ts-pattern'
import type { ApiKeyInfo, GatewayOptions, ProviderProxy } from '.'
import type { ModelAPI } from './api'
import type { BaseAPI } from './api/base'
import { AnthropicProvider } from './newProviders/anthropic'
import { AzureProvider } from './newProviders/azure'
import type { BaseProvider, ExtractedInfo, ProviderOptions } from './newProviders/base'
import { BedrockProvider } from './newProviders/bedrock'
import { GoogleVertexProvider } from './newProviders/google'
import { GroqProvider } from './newProviders/groq'
import { HuggingFaceProvider } from './newProviders/huggingface'
import { OpenAIProvider } from './newProviders/openai'
import { TestProvider } from './newProviders/test'
import type { OtelSpan } from './otel'
import { attributesFromRequest, attributesFromResponse, type GenAIAttributes } from './otel/attributes'
import { runAfter } from './utils'

interface RequestHandlerOptions {
  request: Request
  providerProxy: ProviderProxy
  ctx: ExecutionContext
  gatewayOptions: GatewayOptions
  otelSpan: OtelSpan
  apiKeyInfo: ApiKeyInfo
  restOfPath: string
  middlewares?: Middleware[]
}

export class RequestHandler {
  readonly request: Request
  readonly providerProxy: ProviderProxy
  readonly provider: BaseProvider
  readonly middlewares: Middleware[]
  readonly ctx: ExecutionContext
  readonly gatewayOptions: GatewayOptions
  readonly otelSpan: OtelSpan
  readonly apiKeyInfo: ApiKeyInfo
  readonly restOfPath: string

  constructor(options: RequestHandlerOptions) {
    this.request = options.request
    this.providerProxy = options.providerProxy
    this.ctx = options.ctx
    this.gatewayOptions = options.gatewayOptions
    this.otelSpan = options.otelSpan
    this.apiKeyInfo = options.apiKeyInfo
    this.restOfPath = options.restOfPath
    this.middlewares = options.middlewares ?? []

    // Create provider instance
    this.provider = RequestHandler.getProvider({ restOfPath: this.restOfPath, providerProxy: this.providerProxy })
  }

  static getProvider(options: ProviderOptions): BaseProvider {
    return match(options.providerProxy.providerId)
      .returnType<BaseProvider>()
      .with('openai', () => new OpenAIProvider(options))
      .with('azure', () => new AzureProvider(options))
      .with('groq', () => new GroqProvider(options))
      .with('google-vertex', () => new GoogleVertexProvider(options))
      .with('anthropic', () => new AnthropicProvider(options))
      .with('bedrock', () => new BedrockProvider(options))
      .with('huggingface', () => new HuggingFaceProvider(options))
      .with('test', () => new TestProvider(options))
      .exhaustive()
  }

  async dispatch(): Promise<HandlerResponse> {
    const layers = this.middlewares.reduceRight(
      (next, middleware) => middleware.dispatch(next),
      (handler: RequestHandler) => handler.dispatchInner(),
    )
    return await layers(this)
  }

  protected async dispatchInner(): Promise<HandlerResponse> {
    // Prepare request headers
    const requestHeaders = new Headers(this.request.headers)
    requestHeaders.set('user-agent', this.userAgent())
    requestHeaders.delete('authorization')

    // Authenticate with provider
    const authError = await this.provider.authenticate(requestHeaders)
    if (authError) {
      return authError
    }

    // Extract request info (generic parsing)
    const extracted = await this.extractRequestInfo(this.request)
    if ('error' in extracted) return extracted

    // Get request model from provider (provider-specific interpretation)
    const requestModel = this.provider.getRequestModel(extracted)

    // Get ModelAPI from provider (provider-specific selection)
    const modelAPI = this.provider.getModelAPI(extracted)

    // Get URL from provider (provider-specific construction)
    const url = this.provider.url(extracted)

    const method = this.request.method
    const { requestBodyText, requestBodyData } = extracted

    // Validate that it's possible to calculate the price for the request model
    if (requestModel && this.providerProxy.disableKey && this.providerProxy.providerId !== 'huggingface') {
      const usageProvider = this.usageProvider()
      const price = calcPrice({ input_tokens: 0, output_tokens: 0 }, requestModel, { provider: usageProvider })
      if (!price) {
        return { modelNotFound: true, requestModel }
      }
    }

    // Make the HTTP request
    const response = await this.fetch(url, { method, headers: requestHeaders, body: requestBodyText })

    const responseHeaders = new Headers(response.headers)

    if (!response.ok) {
      const responseBody = await response.text()
      this.otelSpan.end(
        `chat ${requestModel ?? 'unknown-model'}, unexpected response: {http.response.status_code}`,
        {
          ...attributesFromRequest(this.request),
          ...attributesFromResponse(response),
          'http.request.body.text': requestBodyText,
          'http.response.body.text': responseBody,
          'http.response.status_code': response.status,
        },
        { level: 'warn' },
      )
      return {
        requestModel,
        requestBody: requestBodyText,
        unexpectedStatus: response.status,
        responseHeaders,
        responseBody,
      }
    }

    const isStreaming = this.isStreaming(responseHeaders, requestBodyData)
    if (isStreaming) {
      return this.dispatchStreaming(extracted, response, responseHeaders, modelAPI, requestModel)
    }

    // Extract usage from response
    const processResponse = await this.extractUsage(response)
    if ('error' in processResponse) {
      return { ...processResponse, disableKey: this.providerProxy.disableKey ?? true, requestModel }
    }
    const { responseBody, usage, responseModel, cost } = processResponse

    responseHeaders.set('pydantic-ai-gateway-price-estimate', `${cost.toFixed(4)}USD`)

    if (this.providerProxy.injectCost) {
      this.injectCost(responseBody, cost)
    }

    const otelAttributes = modelAPI.extractOtelAttributes(requestBodyData, responseBody)

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

  private userAgent(): string {
    const userAgent = this.request.headers.get('user-agent')
    return `${String(userAgent)} via Pydantic AI Gateway ${this.gatewayOptions.githubSha.substring(0, 7)}, contact engineering@pydantic.dev`
  }

  private async extractRequestInfo(request: Request): Promise<ExtractedInfo | ErrorResponse> {
    const requestBodyText = await request.text()
    let requestBodyData: JsonData
    try {
      requestBodyData = JSON.parse(requestBodyText) as JsonData
    } catch {
      return { error: 'invalid request JSON' }
    }
    return { requestBodyText, requestBodyData }
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    return this.gatewayOptions.subFetch(url, init)
  }

  private usageProvider(): UsageProvider {
    const provider = findProvider({ providerId: this.providerProxy.providerId })
    if (!provider) {
      throw new Error(`Usage provider not found for ${this.providerProxy.providerId}`)
    }
    return provider
  }

  private async extractUsage(response: Response): Promise<ProcessResponse | ErrorResponse> {
    const bodyText = await response.text()
    try {
      const responseBody = JSON.parse(bodyText) as unknown as JsonData
      const usageProvider = this.usageProvider()

      const { model: responseModel, usage } = extractUsage(usageProvider, responseBody, undefined)
      if (!responseModel) {
        return { error: 'Unable to infer response model' }
      }

      const price = calcPrice(usage, responseModel, { provider: usageProvider })
      if (price) {
        return { responseBody, responseModel, usage, cost: price.total_price }
      } else {
        logfire.error('Unable to calculate spend', { responseModel, usage, provider: usageProvider })
        return { error: 'Unable to calculate spend' }
      }
    } catch (error) {
      logfire.reportError('Error extracting usage from response', error as Error, { bodyText })
      return { error: 'invalid response, unable to extract usage' }
    }
  }

  private injectCost(responseBody: JsonData, cost: number) {
    if ('usage' in responseBody) {
      const usage = (responseBody as Record<string, unknown>).usage
      if (isMapping(usage)) {
        usage.pydantic_ai_gateway = { cost_estimate: cost }
      }
    }
  }

  private isStreaming(responseHeaders: Headers, requestBodyData: JsonData): boolean {
    return (
      responseHeaders.get('content-type')?.toLowerCase().startsWith('text/event-stream') ||
      responseHeaders.get('content-type')?.toLowerCase().startsWith('application/vnd.amazon.eventstream') ||
      ('stream' in requestBodyData && requestBodyData.stream === true)
    )
  }

  private dispatchStreaming(
    extracted: ExtractedInfo,
    response: Response,
    responseHeaders: Headers,
    modelAPI: ModelAPI,
    requestModel?: string,
  ): StreamResponse | ErrorResponse {
    if (!response.body) {
      return { requestModel, error: 'No response body' }
    }

    const usageProvider = this.usageProvider()
    const { requestBodyText, requestBodyData } = extracted

    // @ts-expect-error: requestBodyData is a JsonData, but the `processRequest` receives the proper type.
    modelAPI.processRequest(requestBodyData)

    // Start consuming BOTH streams immediately to prevent tee() from buffering
    const [responseStream, processingStream] = response.body.tee()

    let events: AsyncIterable<JsonData>
    if (responseHeaders.get('content-type')?.toLowerCase().startsWith('application/vnd.amazon.eventstream')) {
      events = this.parseAmazonEventStream(processingStream)
    } else {
      events = this.parseSSE(processingStream)
    }

    // @ts-expect-error: TODO(Marcelo): Fix this type error.
    const extractionPromise = this.processChunks(modelAPI, events, usageProvider)

    // Track completion but don't wait for it before returning
    runAfter(this.ctx, 'extract-stream', extractionPromise)

    const onStreamComplete = extractionPromise
      .then((result) => {
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
    usageProvider: UsageProvider,
  ): Promise<{ cost?: number } | { error: Error; disableKey: boolean }> {
    for await (const chunk of events) {
      modelAPI.processChunk(chunk)
    }

    const usage = modelAPI.extractedResponse.usage
    const responseModel = modelAPI.extractedResponse.responseModel

    if (!usage || !responseModel) {
      return {
        error: new Error(`Unable to calculate cost for model ${responseModel}`),
        disableKey: this.providerProxy.disableKey ?? true,
      }
    }

    const price = calcPrice(usage, responseModel, { provider: usageProvider })
    if (price) {
      return { cost: price.total_price }
    } else {
      return {
        error: new Error(`Unable to calculate cost for model ${responseModel} and provider ${usageProvider.name}`),
        disableKey: this.providerProxy.disableKey ?? true,
      }
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

  private async *parseAmazonEventStream(stream: ReadableStream<Uint8Array>): AsyncIterable<JsonData> {
    const encoder = new TextEncoder()
    const codec = new EventStreamCodec((str) => str, encoder.encode)
    const decoder = new TextDecoder()
    let buffer = new Uint8Array(0)

    for await (const chunk of stream) {
      // Append incoming chunk to buffer since messages can span multiple network chunks
      const combined = new Uint8Array(buffer.length + chunk.length)
      combined.set(buffer, 0)
      combined.set(chunk, buffer.length)
      buffer = combined

      // Extract complete messages from buffer (eventstream format: 4-byte length prefix + message data)
      while (buffer.length >= 4) {
        const messageLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)
        if (buffer.length < messageLength) break

        try {
          const message = codec.decode(buffer.subarray(0, messageLength))
          if (message.body?.length > 0) {
            yield JSON.parse(decoder.decode(message.body))
          }
          buffer = buffer.subarray(messageLength)
        } catch (error) {
          logfire.reportError('Error parsing Amazon EventStream', error as Error)
          break
        }
      }
    }
  }
}

type JsonData = object

interface ProcessResponse {
  responseBody: JsonData
  responseModel: string
  usage: Usage
  cost: number
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return v !== null && !Array.isArray(v) && typeof v === 'object'
}

export type Next = (handler: RequestHandler) => Promise<HandlerResponse>

export interface Middleware {
  dispatch(next: Next): Next
}

export interface SuccessResponse {
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

export interface PassthroughResponse {
  response: Response
}

export interface StreamResponse {
  requestModel?: string
  requestBody: string
  successStatus: number
  responseHeaders: Headers
  responseStream: ReadableStream
  otelAttributes?: GenAIAttributes
  onStreamComplete: Promise<{ cost?: number } | { error: Error; disableKey: boolean }>
}

export interface ErrorResponse {
  error: string
  // if true we should disable the key immediately since it appears to be incurring cost we can't measure
  disableKey?: boolean
  requestModel?: string
}

export interface ModelNotFoundResponse {
  modelNotFound: true
  requestModel?: string
}

export interface UnexpectedResponse {
  requestModel?: string
  requestBody: string
  unexpectedStatus: number
  responseHeaders: Headers
  responseBody: string
}

export type HandlerResponse =
  | SuccessResponse
  | StreamResponse
  | PassthroughResponse
  | ErrorResponse
  | ModelNotFoundResponse
  | UnexpectedResponse
