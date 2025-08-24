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
  content: any
}

export interface GenAiUserEvent {
  'event.name': 'gen_ai.user.message'
  role: 'user'
  content: any
}

export interface GenAiToolEvent {
  'event.name': 'gen_ai.tool.message'
  role: 'tool'
  content: any
  id: string
  name?: string
}

export interface GenAiAssistantEvent {
  'event.name': 'gen_ai.assistant.message'
  role: 'assistant'
  content?: any
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

export interface GenaiChoiceEvent {
  'event.name': 'gen_ai.choice'
  finish_reason: string
  index: number
  message: ChoiceMessage
}

export interface ChoiceMessage {
  role: 'assistant'
  content?: any // todo
  tool_calls?: ToolCall[]
}

/*
[
  {
    "content": "Extract information about the person",
    "role": "system",
    "gen_ai.system": "groq",
    "event.name": "gen_ai.system.message"
  },
  {
    "content": "Samuel lived in London and was born on Jan 28th '87",
    "role": "user",
    "gen_ai.system": "groq",
    "gen_ai.message.index": 0,
    "event.name": "gen_ai.user.message"
  },
  {
    "role": "assistant",
    "content": [
      {
        "kind": "thinking",
        "text": "We need to extract name, city, dob. The user says: \"Samuel lived in London and was born on Jan 28th '87\". Name is Samuel. City is London. DOB is Jan 28th '87 -> that is 1987-01-28. Must be ISO 8601 date. So 1987-01-28. Return via function."
      }
    ],
    "tool_calls": [
      {
        "id": "fc_9154a07b-4999-4e80-b057-bd3776d2dbaa",
        "type": "function",
        "function": {
          "name": "final_result",
          "arguments": "{\"city\":\"London\",\"dob\":\"1987-01-28\",\"name\":\"Samuel\"}"
        }
      }
    ],
    "gen_ai.system": "groq",
    "gen_ai.message.index": 1,
    "event.name": "gen_ai.assistant.message"
  },
  {
    "content": "1 validation errors: [\n  {\n    \"type\": \"value_error\",\n    \"loc\": [\n      \"dob\"\n    ],\n    \"msg\": \"Value error, The person must be born in the 19th century\",\n    \"input\": \"1987-01-28\"\n  }\n]\n\nFix the errors and try again.",
    "role": "tool",
    "id": "fc_9154a07b-4999-4e80-b057-bd3776d2dbaa",
    "name": "final_result",
    "gen_ai.system": "groq",
    "gen_ai.message.index": 2,
    "event.name": "gen_ai.tool.message"
  },
  {
    "index": 0,
    "message": {
      "role": "assistant",
      "content": [
        {
          "kind": "thinking",
          "text": "We need dob in 19th century (1800-1899). The user said born Jan 28th '87 which ambiguous could be 1887. So use 1887-01-28. Name Samuel, city London."
        }
      ],
      "tool_calls": [
        {
          "id": "fc_60397e7b-d61c-45d5-87e1-d1d692dd479e",
          "type": "function",
          "function": {
            "name": "final_result",
            "arguments": "{\"city\":\"London\",\"dob\":\"1887-01-28\",\"name\":\"Samuel\"}"
          }
        }
      ]
    },
    "gen_ai.system": "groq",
    "event.name": "gen_ai.choice"
  }
]
*/
