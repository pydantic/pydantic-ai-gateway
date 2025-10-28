import { extractUsage, findProvider, type Usage } from '@pydantic/genai-prices'
import type { GenAIAttributes, GenAIAttributesExtractor } from '../otel/attributes'
import type { InputMessages, OutputMessages, TextPart } from '../otel/genai'
import { type JsonData, safe } from '../providers/default'
import type { ProviderID } from '../types'

export abstract class BaseAPI<RequestBody, ResponseBody>
  implements GenAIAttributesExtractor<RequestBody, ResponseBody>
{
  /** @apiFlavor: the flavor of the API, used to determine the response model and usage */
  apiFlavor: string | undefined = undefined

  readonly providerId: ProviderID
  readonly requestModel?: string

  constructor(providerId: ProviderID, requestModel?: string) {
    this.providerId = providerId
    this.requestModel = requestModel
  }

  extractUsage(responseBody: ResponseBody): Usage | undefined {
    const provider = findProvider({ providerId: this.providerId })
    if (!provider) {
      // This should never happen, but we will throw an error to be safe.
      throw new Error(`Provider not found for provider ID: ${this.providerId}`)
    }
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
