import { AnthropicAPI } from './anthropic'
import { BedrockAPI } from './bedrock'
import { ChatCompletionAPI } from './chat'
import { GoogleAPI } from './google'
import { ResponsesAPI } from './responses'

export type ModelAPI = AnthropicAPI | ChatCompletionAPI | ResponsesAPI | GoogleAPI | BedrockAPI
