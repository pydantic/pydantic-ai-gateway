import { extractUsage, findProvider, type Usage } from '@pydantic/genai-prices'
import type { GenAIAttributes, GenAIAttributesExtractor } from '../otel/attributes'
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

export interface SafeExtractor<RequestBody, ResponseBody, StreamChunk> {
  extractedRequest: ExtractedRequest | undefined
  extractedResponse: Partial<ExtractedResponse>

  processRequest(request: RequestBody): void
  processResponse(response: ResponseBody): void

  processChunk(chunk: StreamChunk): void
  chunkExtractors: ExtractorConfig<StreamChunk, ExtractedResponse>
}

export abstract class BaseAPI<RequestBody, ResponseBody, StreamChunk = JsonData>
  implements GenAIAttributesExtractor<RequestBody, ResponseBody>, SafeExtractor<RequestBody, ResponseBody, StreamChunk>
{
  /** @apiFlavor: the flavor of the API, used to determine the response model and usage */
  apiFlavor: string | undefined = undefined

  readonly providerId: ProviderID
  readonly requestModel?: string

  extractedRequest: ExtractedRequest | undefined = undefined
  extractedResponse: Partial<ExtractedResponse> = {}

  constructor(providerId: ProviderID, requestModel?: string) {
    this.providerId = providerId
    this.requestModel = requestModel
  }

  chunkExtractors: ExtractorConfig<StreamChunk, ExtractedResponse> = {}

  processRequest(_request: RequestBody): void {
    throw new Error('Method not implemented.')
  }
  processResponse(_response: ResponseBody): void {
    throw new Error('Method not implemented.')
  }

  // This runs O(K * N) where K is the number of chunkExtractors and N is the number of chunks.
  // Although this seems inefficient, K is a constant and N is typically small.
  // We do this because we want to ensure that we extract each field separately, so the logic of one of the extractors
  // doesn't make another one to fail.
  processChunk(_chunk: StreamChunk): void {
    for (const [_key, extractor] of Object.entries(this.chunkExtractors)) {
      safe(extractor)(_chunk)
    }
  }

  // TODO(Marcelo): This is not used anywhere yet! We should remove this note when we use it.
  extractUsage(responseBody: ResponseBody | StreamChunk): Usage | undefined {
    const provider = findProvider({ providerId: this.providerId })
    // This should never happen because we know the provider ID is valid, but we will throw an error to be safe.
    if (!provider) throw new Error(`Provider not found for provider ID: ${this.providerId}`)
    const { usage } = extractUsage(provider, responseBody, this.apiFlavor)
    return usage
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
