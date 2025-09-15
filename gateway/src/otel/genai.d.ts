/**
 * Type definitions of OpenTelemetry GenAI spec message parts.
 *
 * Based on https://github.com/pydantic/pydantic-ai/blob/8d4889cc5463133c007df24928ae31bf9f71a10e/pydantic_ai_slim/pydantic_ai/_otel_messages.py
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface TextPart {
  type: 'text'
  content?: string
}

export interface ToolCallPart {
  type: 'tool_call'
  id: string
  name: string
  arguments?: JsonValue
}

export interface ToolCallResponsePart {
  type: 'tool_call_response'
  id: string
  name?: string
  result?: JsonValue
}

// https://github.com/open-telemetry/semantic-conventions/pull/2754/
export interface BlobPart {
  type: 'blob'
  mime_type: string
  data: string
}

export interface FileDataPart {
  type: 'file_data'
  mime_type?: string
  file_uri: string
}

export interface ThinkingPart {
  type: 'thinking'
  content?: string
}

export interface GenericPart {
  type: string
  [key: string]: unknown
}

export type MessagePart =
  | TextPart
  | ToolCallPart
  | ToolCallResponsePart
  | BlobPart
  | FileDataPart
  | ThinkingPart
  | GenericPart

export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  parts: MessagePart[]
}

export type InputMessages = ChatMessage[]

export interface OutputMessage extends ChatMessage {
  finish_reason?: string
}

export type OutputMessages = OutputMessage[]
