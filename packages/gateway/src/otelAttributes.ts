import type { ProxySuccess, ProxyInvalidRequest, ProxyUnexpectedResponse } from './providers/default'
import type { Level, Attributes } from './otel'

export function genAiOtelAttributes(
  result: ProxySuccess | ProxyInvalidRequest | ProxyUnexpectedResponse,
  providerId: string,
): [string, Attributes, Level] {
  const { requestModel } = result
  let spanName = `chat ${requestModel || 'unknown'}`
  let attributes: Attributes = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': requestModel,
    'gen_ai.system': providerId,
  }

  let level: Level = 'info'

  if ('successStatus' in result) {
    const { requestBody, successStatus, responseModel, usage, otelEvents, responseBody } = result
    attributes = {
      ...attributes,
      'http.response.status_code': successStatus,
      'http.request.body': requestBody,
      'http.response.body': responseBody,
      'gen_ai.response.model': responseModel,
      'gen_ai.usage.input_tokens': usage.input_tokens,
      'gen_ai.usage.cache_read_tokens': usage.cache_read_tokens,
      'gen_ai.usage.cache_write_tokens': usage.cache_write_tokens,
      'gen_ai.usage.output_tokens': usage.output_tokens,
      'gen_ai.usage.input_audio_tokens': usage.input_audio_tokens,
      'gen_ai.usage.cache_audio_read_tokens': usage.cache_audio_read_tokens,
      'gen_ai.usage.output_audio_tokens': usage.output_audio_tokens,
      events: otelEvents,
    }
  } else if ('error' in result) {
    const { error } = result
    spanName += ': invalid request {error}'
    attributes = {
      ...attributes,
      error,
    }
    level = 'error'
  } else {
    const { unexpectedStatus, requestBody, responseBody } = result
    spanName += ': unexpected response: {http.response.status_code}'
    attributes = {
      ...attributes,
      'http.response.status_code': unexpectedStatus,
      'http.request.body': requestBody,
      'http.response.body': responseBody,
    }
    level = 'warn'
  }
  return [spanName, attributes, level]
}

export type GenAiOtelEvent = GenAiSystemEvent | GenAiUserEvent | GenaiChoiceEvent

export interface GenAiSystemEvent {
  'event.name': 'gen_ai.system.message'
  'gen_ai.system': string
  role: 'system'
  content: string
}

export interface GenAiUserEvent {
  'event.name': 'gen_ai.user.message'
  'gen_ai.system': string
  role: 'user'
  content: string
}

export interface GenaiChoiceEvent {
  'event.name': 'gen_ai.choice'
  'gen_ai.system': string
  finish_reason: 'stop' | 'tool_calls' | 'content_filter'
  index: number
  message: ChoiceMessage
}

export interface ChoiceMessage {
  content?: any // todo
  role: 'assistant'
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
