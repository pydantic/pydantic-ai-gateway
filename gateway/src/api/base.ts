import type { Provider as UsageProvider } from '@pydantic/genai-prices'
import { extractUsage, findProvider, type Usage } from '@pydantic/genai-prices'
import type { GenAIAttributes, GenAIAttributesExtractor } from '../otel/attributes'
import type { InputMessages, OutputMessages, TextPart } from '../otel/genai'
import { type JsonData, safe } from '../providers/utils'
import type { ProviderID } from '../types'

export interface ExtractedRequest {
  requestModel?: string
  temperature?: number
  maxTokens?: number
  systemInstructions?: TextPart[]
  topP?: number
  topK?: number
  stopSequences?: string[]
  seed?: number
  inputMessages?: InputMessages
}

export interface ExtractedResponse {
  responseModel: string
  responseId: string
  finishReasons: string[]
  outputMessages: OutputMessages
  usage: Usage
}

export type FieldExtractor<Data> = (data: Data) => void

export type ExtractorConfig<Data, Target> = {
  [K in keyof Target]?: FieldExtractor<Data>
}

export type ExtractedData = ExtractedRequest & ExtractedResponse

export interface SafeExtractor<RequestBody, ResponseBody, StreamChunk> {
  extractedRequest: ExtractedRequest
  extractedResponse: Partial<ExtractedResponse>

  processRequest(request: RequestBody): void
  requestExtractors: ExtractorConfig<RequestBody, ExtractedRequest>

  processResponse(response: ResponseBody): void

  processChunk(chunk: StreamChunk): void
  chunkExtractors: ExtractorConfig<StreamChunk, ExtractedResponse>
}

export abstract class BaseAPI<RequestBody, ResponseBody, StreamChunk = JsonData>
  implements GenAIAttributesExtractor<RequestBody, ResponseBody>, SafeExtractor<RequestBody, ResponseBody, StreamChunk>
{
  private usageProvider: UsageProvider | undefined

  /** @apiFlavor: the flavor of the API, used to determine the response model and usage */
  apiFlavor: string | undefined = undefined

  readonly providerId: ProviderID
  readonly requestModel?: string

  extractedRequest: ExtractedRequest = {}
  extractedResponse: Partial<ExtractedResponse> = {}

  constructor(providerId: ProviderID, requestModel?: string, options?: { usageProvider?: UsageProvider }) {
    this.providerId = providerId
    this.requestModel = requestModel
    this.usageProvider = options?.usageProvider
  }

  requestExtractors: ExtractorConfig<RequestBody, ExtractedRequest> = {}
  chunkExtractors: ExtractorConfig<StreamChunk, ExtractedResponse> = {}

  processRequest(request: RequestBody): void {
    for (const extractor of Object.values(this.requestExtractors)) {
      safe(extractor)(request)
    }
  }

  processResponse(_response: ResponseBody): void {
    throw new Error('Method not implemented.')
  }

  // This runs O(K * N) where K is the number of chunkExtractors and N is the number of chunks.
  // Although this seems inefficient, K is a constant and N is typically small.
  // We do this because we want to ensure that we extract each field separately, so the logic of one of the extractors
  // doesn't make another one to fail.
  processChunk(chunk: StreamChunk): void {
    for (const extractor of Object.values(this.chunkExtractors)) {
      safe(extractor)(chunk)
    }
  }

  extractUsage(responseBody: ResponseBody | StreamChunk): Usage | undefined {
    const provider = this.usageProvider ?? findProvider({ providerId: this.providerId })
    // This should never happen because we know the provider ID is valid, but we will throw an error to be safe.
    if (!provider) throw new Error(`Provider not found for provider ID: ${this.providerId}`)
    const { usage } = extractUsage(provider, responseBody, this.apiFlavor)
    return usage
  }

  toGenAiOtelAttributes(): GenAIAttributes {
    return omitUndefined({
      'gen_ai.system': this.providerId,
      'gen_ai.operation.name': 'chat',
      // Request Attributes
      'gen_ai.request.model': this.extractedRequest?.requestModel,
      'gen_ai.request.max_tokens': this.extractedRequest?.maxTokens,
      'gen_ai.request.temperature': this.extractedRequest?.temperature,
      'gen_ai.request.top_p': this.extractedRequest?.topP,
      'gen_ai.request.top_k': this.extractedRequest?.topK,
      'gen_ai.request.stop_sequences': this.extractedRequest?.stopSequences,
      'gen_ai.request.seed': this.extractedRequest?.seed,
      'gen_ai.system_instructions': this.extractedRequest?.systemInstructions,
      'gen_ai.input.messages': this.extractedRequest?.inputMessages,
      // Response Attributes
      'gen_ai.response.model': this.extractedResponse?.responseModel,
      'gen_ai.response.id': this.extractedResponse?.responseId,
      'gen_ai.response.finish_reasons': this.extractedResponse?.finishReasons,
      'gen_ai.output.messages': this.extractedResponse?.outputMessages,
      'gen_ai.usage.input_tokens': this.extractedResponse?.usage?.input_tokens,
      'gen_ai.usage.cache_read_tokens': this.extractedResponse?.usage?.cache_read_tokens,
      'gen_ai.usage.cache_write_tokens': this.extractedResponse?.usage?.cache_write_tokens,
      'gen_ai.usage.output_tokens': this.extractedResponse?.usage?.output_tokens,
      'gen_ai.usage.input_audio_tokens': this.extractedResponse?.usage?.input_audio_tokens,
      'gen_ai.usage.cache_audio_read_tokens': this.extractedResponse?.usage?.cache_audio_read_tokens,
      'gen_ai.usage.output_audio_tokens': this.extractedResponse?.usage?.output_audio_tokens,
    })
  }

  // GenAIAttributesExtractor implementation

  requestMaxTokens?: (requestBody: RequestBody) => number | undefined
  requestSeed?: (requestBody: RequestBody) => number | undefined
  requestStopSequences?: (requestBody: RequestBody) => string[] | undefined
  requestTemperature?: (requestBody: RequestBody) => number | undefined
  requestTopK?: (requestBody: RequestBody) => number | undefined
  requestTopP?: (requestBody: RequestBody) => number | undefined
  responseId?: (responseBody: ResponseBody) => string | undefined
  responseFinishReasons?: (responseBody: ResponseBody) => string[] | undefined
  inputMessages?: (requestBody: RequestBody) => InputMessages | undefined
  outputMessages?: (responseBody: ResponseBody) => OutputMessages | undefined
  systemInstructions?: (requestBody: RequestBody) => TextPart[] | undefined

  extractOtelAttributes(requestBody: JsonData, responseBody: JsonData): GenAIAttributes {
    return {
      'gen_ai.system': this.providerId,
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.max_tokens': this.genAIAttributes('requestMaxTokens', requestBody as RequestBody),
      'gen_ai.request.top_k': this.genAIAttributes('requestTopK', requestBody as RequestBody),
      'gen_ai.request.top_p': this.genAIAttributes('requestTopP', requestBody as RequestBody),
      'gen_ai.request.temperature': this.genAIAttributes('requestTemperature', requestBody as RequestBody),
      'gen_ai.request.stop_sequences': this.genAIAttributes('requestStopSequences', requestBody as RequestBody),
      'gen_ai.request.seed': this.genAIAttributes('requestSeed', requestBody as RequestBody),
      'gen_ai.response.finish_reasons': this.genAIAttributes('responseFinishReasons', responseBody as ResponseBody),
      'gen_ai.response.id': this.genAIAttributes('responseId', responseBody as ResponseBody),
      'gen_ai.input.messages': this.genAIAttributes('inputMessages', requestBody as RequestBody),
      'gen_ai.output.messages': this.genAIAttributes('outputMessages', responseBody as ResponseBody),
      'gen_ai.system_instructions': this.genAIAttributes('systemInstructions', requestBody as RequestBody),
    }
  }

  genAIAttributes<T extends keyof GenAIAttributesExtractor<RequestBody, ResponseBody>>(
    extractorName: T,
    ...args: Parameters<NonNullable<GenAIAttributesExtractor<RequestBody, ResponseBody>[T]>>
  ): ReturnType<NonNullable<GenAIAttributesExtractor<RequestBody, ResponseBody>[T]>> | undefined {
    if (extractorName in this && typeof this[extractorName] === 'function') {
      // @ts-expect-error inherit from GenAIAttributesExtractor
      return safe(this[extractorName])(...args) as ReturnType<
        NonNullable<GenAIAttributesExtractor<RequestBody, ResponseBody>[T]>
      >
    }
    return undefined
  }
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined)) as Partial<T>
}
