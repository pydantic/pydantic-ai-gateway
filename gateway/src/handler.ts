import { calcPrice, extractUsage, type Usage, type Provider as UsageProvider } from '@pydantic/genai-prices'
import { EventStreamCodec } from '@smithy/eventstream-codec'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import logfire from 'logfire'
import { match } from 'ts-pattern'
import type { ApiKeyInfo, GatewayOptions, ProviderProxy } from '.'
import type { ModelAPI } from './api'
import type { BaseAPI } from './api/base'
import type { OtelSpan } from './otel'
import { attributesFromRequest, attributesFromResponse, type GenAIAttributes } from './otel/attributes'
import { AnthropicProvider } from './providers/anthropic'
import { AzureProvider } from './providers/azure'
import type { BaseProvider, ExtractedInfo, ProviderOptions } from './providers/base'
import { BedrockProvider } from './providers/bedrock'
import { GoogleVertexProvider } from './providers/google'
import { GroqProvider } from './providers/groq'
import { HuggingFaceProvider } from './providers/huggingface'
import { OpenAIProvider } from './providers/openai'
import { OVHcloudProvider } from './providers/ovhcloud'
import { TestProvider } from './providers/test'
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

    this.provider = RequestHandler.getProvider({
      restOfPath: this.restOfPath,
      providerProxy: this.providerProxy,
      kv: this.gatewayOptions.kv,
      subFetch: this.gatewayOptions.subFetch,
    })
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
      .with('ovhcloud', () => new OVHcloudProvider(options))
      .with('test', () => new TestProvider(options))
      .exhaustive()
  }

  providerId(): string {
    return this.provider.providerId()
  }

  disableKey(): boolean {
    return this.providerProxy.disableKey ?? true
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

    // Check if this is a whitelisted endpoint (bypass usage tracking)
    if (this.provider.isWhitelistedEndpoint()) {
      return await this.handleWhitelistedEndpoint(requestHeaders)
    }

    // Extract request info (generic parsing)
    const extracted = await this.extractRequestInfo(this.request)
    if ('error' in extracted) return extracted

    // Get request model from original extracted data
    const requestModel = this.provider.getRequestModel(extracted)

    // Prepare request body (provider may modify it)
    const prepared = this.provider.requestBody(extracted)
    if ('error' in prepared) return prepared

    const url = this.provider.url(prepared, requestModel)

    const method = this.request.method
    const { requestBodyText, requestBodyData } = prepared

    // Validate that it's possible to calculate the price for the request model
    if (requestModel && this.providerProxy.disableKey && this.providerProxy.providerId !== 'huggingface') {
      const usageProvider = this.usageProvider()
      const price = calcPrice({ input_tokens: 0, output_tokens: 0 }, requestModel, { provider: usageProvider })
      if (!price) {
        return { modelNotFound: true, requestModel }
      }
    }

    const response = await this.fetch(url, { method, headers: requestHeaders, body: requestBodyText })

    const responseHeaders = new Headers(response.headers)
    this.provider.filterResponseHeaders(responseHeaders)

    if (!response.ok) {
      // CAUTION: can we be charged in any way for failed requests?
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

    const modelAPI = this.provider.getModelAPIWithFlavor(prepared)

    if (this.isStreaming(responseHeaders, requestBodyData)) {
      return this.dispatchStreaming(extracted, response, responseHeaders, modelAPI, requestModel)
    }

    const processResponse = await this.extractUsage(response, extracted)
    if ('error' in processResponse) {
      return { ...processResponse, disableKey: this.disableKey(), requestModel }
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
    // Use provider's custom fetch if available (e.g., TestProvider)
    if (this.provider.fetch) {
      return this.provider.fetch(url, init)
    }
    const { subFetch } = this.gatewayOptions
    return subFetch(url, init)
  }

  private async handleWhitelistedEndpoint(headers: Headers): Promise<HandlerResponse> {
    const url = this.provider.url({ requestBodyText: '', requestBodyData: {} })
    const response = await this.fetch(url, { method: this.request.method, headers, body: this.request.body })

    const responseHeaders = new Headers(response.headers)
    this.provider.filterResponseHeaders(responseHeaders)

    this.otelSpan.end(
      `${this.request.method} ${this.restOfPath}`,
      { ...attributesFromRequest(this.request), ...attributesFromResponse(response) },
      { level: 'info' },
    )

    return { response }
  }

  private usageProvider(): UsageProvider | undefined {
    const provider = this.provider.usageProvider()
    return provider
  }

  private async extractUsage(response: Response, extracted?: ExtractedInfo): Promise<ProcessResponse | ErrorResponse> {
    const bodyText = await response.text()
    try {
      const responseBody = JSON.parse(bodyText) as unknown as JsonData
      const usageProvider = this.usageProvider()
      // TODO(Marcelo): Check if the next line is ever reached. I think `usageProvider` is always a valid provider at this point.
      if (!usageProvider) {
        return { error: 'invalid response JSON, provider not found' }
      }

      let { model: responseModel, usage } = extractUsage(usageProvider, responseBody, this.provider.apiFlavor)
      if (!responseModel && extracted) {
        // If the response model cannot be extracted from the response body, try to get it from the request
        responseModel = this.provider.getRequestModel(extracted) ?? null
      }
      if (!responseModel) {
        return { error: 'Unable to infer response model' }
      }

      responseModel = this.provider.replaceModel(responseModel)
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

    const provider = this.usageProvider()
    if (!provider) {
      return { error: 'No usage provider found' }
    }

    const { requestBodyText, requestBodyData } = extracted

    // @ts-expect-error: requestBodyData is a JsonData, but the `processRequest` receives the proper type.
    modelAPI.processRequest(requestBodyData)

    // Start consuming BOTH streams immediately to prevent tee() from buffering
    const [rawResponseStream, processingStream] = response.body.tee()

    let events: AsyncIterable<JsonData>
    let responseStream: ReadableStream
    if (responseHeaders.get('content-type')?.toLowerCase().startsWith('application/vnd.amazon.eventstream')) {
      events = this.parseAmazonEventStream(processingStream)
      responseStream = this.convertAmazonEventStream(rawResponseStream)
    } else {
      events = this.parseSSE(processingStream)
      responseStream = rawResponseStream
    }

    // @ts-expect-error: TODO(Marcelo): Fix this type error.
    const extractionPromise = this.processChunks(modelAPI, events, provider)

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
    usageProvider: UsageProvider,
  ): Promise<{ cost?: number } | { error: Error; disableKey: boolean }> {
    for await (const chunk of events) {
      modelAPI.processChunk(chunk)
    }

    const provider = this.usageProvider()
    const { usage, responseModel } = modelAPI.extractedResponse

    if (!usage || !responseModel) {
      return { error: new Error(`Unable to calculate cost for model ${responseModel}`), disableKey: this.disableKey() }
    }

    const price = calcPrice(usage, responseModel, { provider })
    if (price) {
      return { cost: price.total_price }
    } else {
      return {
        error: new Error(`Unable to calculate cost for model ${responseModel} and provider ${usageProvider.name}`),
        disableKey: this.disableKey(),
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

  private convertAmazonEventStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    // Convert the amazon event stream to be API-compatible with Anthropic
    const encoder = new TextEncoder()
    const codec = new EventStreamCodec((str) => str, encoder.encode)
    const decoder = new TextDecoder()
    let buffer = new Uint8Array(0)
    const reader = stream.getReader()

    return new ReadableStream({
      async pull(controller) {
        try {
          // Keep reading until we emit something or the stream ends
          while (true) {
            const { done, value: chunk } = await reader.read()

            if (done) {
              controller.close()
              return
            }

            if (chunk) {
              const combined = new Uint8Array(buffer.length + chunk.length)
              combined.set(buffer, 0)
              combined.set(chunk, buffer.length)
              buffer = combined

              let emitted = false
              while (buffer.length >= 4) {
                const messageLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)
                if (buffer.length < messageLength) break

                try {
                  const message = codec.decode(buffer.subarray(0, messageLength))
                  if (message.body?.length > 0) {
                    const decoded = JSON.parse(decoder.decode(message.body))
                    const payload = atob(decoded.bytes)
                    const parsed = JSON.parse(payload)
                    // Format as SSE with event type to match Anthropic API format
                    const sseData = `event: ${parsed.type}\ndata: ${payload}\n\n`
                    controller.enqueue(encoder.encode(sseData))
                    emitted = true
                  }
                  buffer = buffer.subarray(messageLength)
                } catch (error) {
                  logfire.reportError('Error parsing Amazon EventStream', error as Error)
                  break
                }
              }

              // Only return once we've emitted data
              if (emitted) return
            }
          }
        } catch (error) {
          controller.error(error)
        }
      },
      cancel() {
        reader.cancel()
      },
    })
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
