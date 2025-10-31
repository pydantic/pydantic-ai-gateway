/** This module implements the OpenAI Chat Completion API.
 * @see https://platform.openai.com/docs/api-reference/chat
 */

import * as logfire from '@pydantic/logfire-api'
import mime from 'mime-types'
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { ChatMessage, InputMessages, MessagePart, OutputMessage, OutputMessages } from '../otel/genai'
import { BaseAPI, type ExtractedRequest, type ExtractedResponse, type ExtractorConfig } from './base'

export class ChatCompletionAPI extends BaseAPI<ChatCompletionCreateParams, ChatCompletion, ChatCompletionChunk> {
  apiFlavor = 'chat'

  requestStopSequences = (requestBody: ChatCompletionCreateParams): string[] | undefined => {
    return typeof requestBody.stop === 'string' ? [requestBody.stop] : (requestBody.stop ?? undefined)
  }

  requestTemperature = (requestBody: ChatCompletionCreateParams): number | undefined => {
    return requestBody.temperature ?? undefined
  }

  requestTopP = (requestBody: ChatCompletionCreateParams): number | undefined => requestBody.top_p ?? undefined

  requestMaxTokens = (requestBody: ChatCompletionCreateParams): number | undefined => {
    return requestBody.max_completion_tokens ?? undefined
  }

  responseId = (responseBody: ChatCompletion): string | undefined => responseBody.id

  responseFinishReasons = (responseBody: ChatCompletion): string[] | undefined => {
    return responseBody.choices.map((choice) => choice.finish_reason)
  }

  inputMessages = (requestBody: ChatCompletionCreateParams): InputMessages | undefined => {
    return requestBody.messages.map(mapInputMessage)
  }

  outputMessages = (responseBody: ChatCompletion): OutputMessages | undefined => {
    return responseBody.choices.map(mapOutputMessage)
  }

  // SafeExtractor implementation

  requestExtractors: ExtractorConfig<ChatCompletionCreateParams, ExtractedRequest> = {
    requestModel: (requestBody: ChatCompletionCreateParams) => {
      this.extractedRequest.requestModel = requestBody.model ?? undefined
    },
    maxTokens: (requestBody: ChatCompletionCreateParams) => {
      this.extractedRequest.maxTokens = requestBody.max_completion_tokens ?? undefined
    },
    temperature: (requestBody: ChatCompletionCreateParams) => {
      this.extractedRequest.temperature = requestBody.temperature ?? undefined
    },
    topP: (requestBody: ChatCompletionCreateParams) => {
      this.extractedRequest.topP = requestBody.top_p ?? undefined
    },
    stopSequences: (requestBody: ChatCompletionCreateParams) => {
      this.extractedRequest.stopSequences =
        typeof requestBody.stop === 'string' ? [requestBody.stop] : (requestBody.stop ?? undefined)
    },
  }

  chunkExtractors: ExtractorConfig<ChatCompletionChunk, ExtractedResponse> = {
    usage: (chunk: ChatCompletionChunk) => {
      if ('usage' in chunk && chunk.usage) {
        this.extractedResponse.usage = this.extractUsage(chunk)
      }
    },
    responseModel: (chunk: ChatCompletionChunk) => {
      console.error('responseModel', chunk)
      if ('model' in chunk && chunk.model) {
        this.extractedResponse.responseModel = chunk.model
      }
    },
    responseId: (chunk: ChatCompletionChunk) => {
      if ('id' in chunk && chunk.id) {
        this.extractedResponse.responseId = chunk.id
      }
    },
    finishReasons: (chunk: ChatCompletionChunk) => {
      const finishReasons: string[] = []
      for (const choice of chunk.choices) {
        if (choice.finish_reason) {
          finishReasons.push(choice.finish_reason)
        }
      }
      this.extractedResponse.finishReasons = finishReasons.length > 0 ? finishReasons : undefined
    },
    // TODO(Marcelo): We should implement this one.
    outputMessages: (_chunk: ChatCompletionChunk) => {},
  }
}

export function mapInputMessage(message: ChatCompletionMessageParam): ChatMessage {
  let role = message.role === 'function' || message.role === 'tool' ? 'assistant' : message.role
  role = role === 'developer' ? 'system' : role
  return { role, parts: mapInputParts(message.content) }
}

function mapInputParts(content: ChatCompletionMessageParam['content']): MessagePart[] {
  const parts: MessagePart[] = []

  if (content === null || content === undefined) {
    return parts
  }

  if (typeof content === 'string') {
    parts.push({ type: 'text', content })
  } else {
    for (const part of content) {
      if (part.type === 'text') {
        parts.push({ type: 'text', content: part.text })
      } else if (part.type === 'image_url') {
        parts.push({ type: 'file_data', file_uri: part.image_url.url })
      } else if (part.type === 'input_audio') {
        const mimeType = mime.contentType(part.input_audio.format) || undefined
        parts.push({ type: 'blob', mime_type: mimeType, data: part.input_audio.data })
      } else if (part.type === 'file' && part.file.file_data) {
        const mimeType = part.file.filename ? mime.contentType(part.file.filename) || undefined : undefined
        parts.push({ type: 'blob', mime_type: mimeType, data: part.file.file_data })
      } else {
        parts.push({ type: 'unknown', part: { ...part } })
      }
    }
  }
  return parts
}

export function mapOutputMessage(choice: ChatCompletion.Choice): OutputMessage {
  return { role: choice.message.role, parts: mapOutputParts(choice.message), finish_reason: choice.finish_reason }
}

function mapOutputParts(message: ChatCompletion.Choice['message']): MessagePart[] {
  const parts: MessagePart[] = []

  if (typeof message.content === 'string') {
    parts.push({ type: 'text', content: message.content })
  } else if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      parts.push({
        type: 'tool_call',
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })
    }
  } else {
    logfire.warning('unexpected message content', { message })
  }
  return parts
}
