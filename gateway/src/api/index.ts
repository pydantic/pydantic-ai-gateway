import type { AnthropicAPI } from './anthropic'
import type { BedrockAPI } from './bedrock'
import type { ChatCompletionAPI } from './chat'
import type { GoogleAPI } from './google'
import type { ResponsesAPI } from './responses'

export type ModelAPI = AnthropicAPI | ChatCompletionAPI | ResponsesAPI | GoogleAPI | BedrockAPI
