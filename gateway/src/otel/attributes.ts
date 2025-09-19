import type { Attributes, Level } from '.'
import type {
  DefaultProviderProxy,
  ProxyInvalidRequest,
  ProxySuccess,
  ProxyUnexpectedResponse,
} from '../providers/default'
import { InputMessages, OutputMessages, TextPart } from './genai'

export function genAiOtelAttributes(
  result: ProxySuccess | ProxyInvalidRequest | ProxyUnexpectedResponse,
  provider: DefaultProviderProxy,
): [string, Attributes, Level] {
  const { requestModel } = result
  let spanName: string
  let attributes: Attributes = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': requestModel,
    'gen_ai.system': provider.providerId(),
  }

  let level: Level = 'info'

  if ('successStatus' in result) {
    const { requestBody, successStatus, responseModel, usage, otelEvents, responseBody, otelAttributes } = result
    spanName = `chat ${responseModel}`
    attributes = {
      ...attributes,
      ...otelAttributes,
      'http.response.status_code': successStatus,
      'http.request.body.text': requestBody,
      'http.response.body.text': responseBody,
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
    spanName = `chat ${requestModel ?? 'unknown-model'}, invalid request {error}`
    attributes = { ...attributes, error }
    level = 'error'
  } else {
    const { unexpectedStatus, requestBody, responseBody } = result
    spanName = `chat ${requestModel ?? 'unknown-model'}, unexpected response: {http.response.status_code}`
    attributes = {
      ...attributes,
      'http.response.status_code': unexpectedStatus,
      'http.request.body.text': requestBody,
      'http.response.body.text': responseBody,
    }
    level = 'warn'
  }
  return [spanName, attributes, level]
}

// The following should be added by otel.ts
// * 'gen_ai.message.index': number - apparently used by logfire
// * 'gen_ai.system': string - otel stand
export type GenAiOtelEvent =
  | GenAiSystemEvent
  | GenAiUserEvent
  | GenAiToolEvent
  | GenAiAssistantEvent
  | GenaiChoiceEvent

export interface GenAiSystemEvent {
  'event.name': 'gen_ai.system.message'
  role: 'system'
  content: unknown
}

export interface GenAiUserEvent {
  'event.name': 'gen_ai.user.message'
  role: 'user'
  content: unknown
}

export interface GenAiToolEvent {
  'event.name': 'gen_ai.tool.message'
  role: 'tool'
  content: unknown
  id: string
  name?: string
}

export interface GenAiAssistantEvent {
  'event.name': 'gen_ai.assistant.message'
  role: 'assistant'
  content?: unknown
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface GenaiChoiceEvent {
  'event.name': 'gen_ai.choice'
  finish_reason: string
  index: number
  message: ChoiceMessage
}

export interface ChoiceMessage {
  role: 'assistant'
  content?: unknown // todo
  tool_calls?: ToolCall[]
}

/** Semantic conventions for Generative AI
 * @see https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
 */
export interface GenAIAttributes {
  'gen_ai.request.max_tokens'?: number
  'gen_ai.request.seed'?: number
  'gen_ai.request.stop_sequences'?: string[]
  'gen_ai.request.temperature'?: number
  'gen_ai.request.top_k'?: number
  'gen_ai.request.top_p'?: number
  'gen_ai.response.id'?: string
  'gen_ai.response.finish_reasons'?: string[]
  'gen_ai.input.messages'?: InputMessages
  'gen_ai.output.messages'?: OutputMessages
  'gen_ai.system_instructions'?: TextPart[]
}

export interface GenAIAttributesExtractor<RequestBody, ResponseBody> {
  requestMaxTokens?: (request: RequestBody) => GenAIAttributes['gen_ai.request.max_tokens']
  requestSeed?: (request: RequestBody) => GenAIAttributes['gen_ai.request.seed']
  requestStopSequences?: (request: RequestBody) => GenAIAttributes['gen_ai.request.stop_sequences']
  requestTemperature?: (request: RequestBody) => GenAIAttributes['gen_ai.request.temperature']
  requestTopK?: (request: RequestBody) => GenAIAttributes['gen_ai.request.top_k']
  requestTopP?: (request: RequestBody) => GenAIAttributes['gen_ai.request.top_p']
  responseFinishReasons?: (response: ResponseBody) => GenAIAttributes['gen_ai.response.finish_reasons']
  responseId?: (response: ResponseBody) => GenAIAttributes['gen_ai.response.id']
  inputMessages?: (request: RequestBody) => GenAIAttributes['gen_ai.input.messages']
  outputMessages?: (response: ResponseBody) => GenAIAttributes['gen_ai.output.messages']
  systemInstructions?: (request: RequestBody) => GenAIAttributes['gen_ai.system_instructions']
}
