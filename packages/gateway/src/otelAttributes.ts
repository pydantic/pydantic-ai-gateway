interface GenAiOtelAttributes {
  'gen_ai.operation.name': 'chat'
  'gen_ai.system': string
  'gen_ai.request.model'?: string
  'gen_ai.response.model'?: string
  'gen_ai.usage.input_tokens'?: number
  'gen_ai.usage.cache_read_tokens'?: number
  'gen_ai.usage.cache_write_tokens'?: number
  'gen_ai.usage.output_tokens'?: number
  'gen_ai.usage.input_audio_tokens'?: number
  'gen_ai.usage.cache_audio_read_tokens'?: number
  'gen_ai.usage.output_audio_tokens'?: number
  events: (GenAiSystemEvent | GenAiUserEvent | GenaiChoiceEvent)[]
}

interface GenAiSystemEvent {
  'event.name': 'gen_ai.system.message'
  'gen_ai.system': string
  role: 'system'
  content: string
}

interface GenAiUserEvent {
  'event.name': 'gen_ai.user.message'
  'gen_ai.system': string
  role: 'user'
  content: string
}

interface GenaiChoiceEvent {
  'event.name': 'gen_ai.choice'
  'gen_ai.system': string
  finish_reason: 'stop' | 'tool_calls' | 'content_filter'
  index: number
  message: ChoiceMessage
}

interface ChoiceMessage {
  content?: any // todo
  role: 'assistant'
  tool_calls?: ToolCall[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}
