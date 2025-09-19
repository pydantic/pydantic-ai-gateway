import { AnthropicAPI } from './anthropic'
import { ChatCompletionAPI } from './chat'
import { GoogleAPI } from './google'
import { HarmonyAPI } from './harmony'
import { ResponsesAPI } from './responses'

export interface APIFlavor {
  chat: ChatCompletionAPI
  responses: ResponsesAPI<object, object>
  harmony: HarmonyAPI<object, object>
  anthropic: AnthropicAPI
  google: GoogleAPI
}

const apiConstructors = {
  chat: ChatCompletionAPI,
  responses: ResponsesAPI,
  harmony: HarmonyAPI,
  anthropic: AnthropicAPI,
  google: GoogleAPI,
} as const

export function createAPI<T extends keyof APIFlavor>(apiType: T): APIFlavor[T] {
  const Constructor = apiConstructors[apiType]
  return new Constructor() as APIFlavor[T]
}
