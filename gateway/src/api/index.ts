import { AnthropicAPI } from './anthropic'
import { ChatCompletionAPI } from './chat'
import { GoogleAPI } from './google'
import { ResponsesAPI } from './responses'

export type ModelAPI = AnthropicAPI | ChatCompletionAPI | ResponsesAPI | GoogleAPI
