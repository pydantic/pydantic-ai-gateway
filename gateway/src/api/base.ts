import { extractUsage, findProvider, type Usage } from '@pydantic/genai-prices'
import type { GenAIAttributes } from '../otel/attributes'
import type { InputMessages, OutputMessages, TextPart } from '../otel/genai'
import { type JsonData, safe } from '../providers/default'
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
  implements SafeExtractor<RequestBody, ResponseBody, StreamChunk>
{
  /** @apiFlavor: the flavor of the API, used to determine the response model and usage */
  apiFlavor: string | undefined = undefined

  readonly providerId: ProviderID
  readonly requestModel?: string

  extractedRequest: ExtractedRequest = {}
  extractedResponse: Partial<ExtractedResponse> = {}

  constructor(providerId: ProviderID, requestModel?: string) {
    this.providerId = providerId
    this.requestModel = requestModel
  }

  requestExtractors: ExtractorConfig<RequestBody, ExtractedRequest> = {}
  responseExtractors: ExtractorConfig<ResponseBody, ExtractedResponse> = {}
  chunkExtractors: ExtractorConfig<StreamChunk, ExtractedResponse> = {}

  processRequest(request: RequestBody): void {
    for (const extractor of Object.values(this.requestExtractors)) {
      safe(extractor)(request)
    }
  }

  processResponse(response: ResponseBody): void {
    for (const extractor of Object.values(this.responseExtractors)) {
      safe(extractor)(response)
    }
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
    const provider = findProvider({ providerId: this.providerId })
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
      'gen_ai.request.model': this.requestModel ?? this.extractedRequest?.requestModel,
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
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined)) as Partial<T>
}
