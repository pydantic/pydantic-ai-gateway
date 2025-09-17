/** we're working with snake_case keys from the Groq API */

import type { ChatCompletion, ChatCompletionCreateParamsBase } from '@groq-chat/completions'

import { InputMessages, OutputMessages } from '../otel/genai'
import { DefaultProviderProxy } from './default'
import { mapInputMessage, mapOutputMessage } from './openai'

export class GroqProvider extends DefaultProviderProxy<ChatCompletionCreateParamsBase, ChatCompletion> {
  defaultBaseUrl = 'https://api.groq.com'

  requestStopSequences = (requestBody: ChatCompletionCreateParamsBase): string[] | undefined => {
    return typeof requestBody.stop === 'string' ? [requestBody.stop] : (requestBody.stop ?? undefined)
  }

  requestTemperature = (requestBody: ChatCompletionCreateParamsBase): number | undefined => {
    return requestBody.temperature ?? undefined
  }

  requestTopP = (requestBody: ChatCompletionCreateParamsBase): number | undefined => requestBody.top_p ?? undefined

  requestMaxTokens = (requestBody: ChatCompletionCreateParamsBase): number | undefined => {
    return requestBody.max_completion_tokens ?? undefined
  }

  responseId = (responseBody: ChatCompletion): string | undefined => responseBody.id

  responseFinishReasons = (responseBody: ChatCompletion): string[] | undefined => {
    return responseBody.choices.map((choice) => choice.finish_reason)
  }

  inputMessages = (_requestBody: ChatCompletionCreateParamsBase): InputMessages | undefined => {
    // @ts-expect-error TODO(Marcelo): We should create a better API to extract OTel in Chat Completions.
    return _requestBody.messages.map(mapInputMessage)
  }

  outputMessages = (_responseBody: ChatCompletion): OutputMessages | undefined => {
    // @ts-expect-error TODO(Marcelo): We should create a better API to extract OTel in Chat Completions.
    return _responseBody.choices.map(mapOutputMessage)
  }
}
