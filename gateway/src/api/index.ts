import { AnthropicAPI } from './anthropic'
import { ChatCompletionAPI } from './chat'
import { GoogleAPI } from './google'
import { HarmonyAPI } from './harmony'
import { ResponsesAPI } from './responses'

export type ModelAPI = AnthropicAPI | ChatCompletionAPI | HarmonyAPI | ResponsesAPI | GoogleAPI
