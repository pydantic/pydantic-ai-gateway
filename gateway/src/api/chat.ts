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
        parts.push({ type: 'uri', uri: part.image_url.url, modality: 'image' })
      } else if (part.type === 'input_audio') {
        const mimeType = mime.contentType(part.input_audio.format) || undefined
        parts.push({ type: 'blob', mime_type: mimeType, content: part.input_audio.data, modality: 'audio' })
      } else if (part.type === 'file' && part.file.file_data) {
        const mimeType = _extractMimeTypeFromBase64(part.file.file_data)
        parts.push({ type: 'blob', mime_type: mimeType, content: part.file.file_data, modality: 'document' })
      } else if (part.type === 'file' && part.file.file_id) {
        const mimeType = part.file.filename ? mime.contentType(part.file.filename) || undefined : undefined
        parts.push({ type: 'file', file_id: part.file.file_id, mime_type: mimeType, modality: 'unknown' })
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

function _extractMimeTypeFromBase64(base64: string): string | undefined {
  // The format is always "data:image/png;base64,{base64}"
  const match = base64.match(/^data:([^;]+);base64,/)
  return match ? match[1] : undefined
}
