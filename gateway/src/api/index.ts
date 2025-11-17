import type { AnthropicAPI } from './anthropic'
import type { ConverseAPI } from './bedrock'
import type { ChatCompletionAPI } from './chat'
import type { EmbeddingsAPI } from './embeddings'
import type { GoogleAPI } from './google'
import type { ResponsesAPI } from './responses'

export type ModelAPI = AnthropicAPI | ChatCompletionAPI | ResponsesAPI | GoogleAPI | ConverseAPI | EmbeddingsAPI
