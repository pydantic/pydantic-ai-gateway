/** This module implements the OpenAI Chat Completion API.
 * @see https://platform.openai.com/docs/api-reference/chat
 */
import * as logfire from '@pydantic/logfire-api'
import mime from 'mime-types'
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { ChatMessage, InputMessages, MessagePart, OutputMessage, OutputMessages } from '../otel/genai'
import { BaseAPI } from './base'

export class ChatCompletionAPI extends BaseAPI<ChatCompletionCreateParams, ChatCompletion> {
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

  inputMessages = (_requestBody: ChatCompletionCreateParams): InputMessages | undefined => {
    return _requestBody.messages.map(mapInputMessage)
  }

  outputMessages = (_responseBody: ChatCompletion): OutputMessages | undefined => {
    return _responseBody.choices.map(mapOutputMessage)
  }
}

export function mapInputMessage(message: ChatCompletionMessageParam): ChatMessage {
  // TODO(Marcelo): There's probably a cuter way to do this.
  const role = message.role === 'function' ? 'tool' : message.role === 'developer' ? 'system' : message.role
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
        parts.push({ ...part })
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
