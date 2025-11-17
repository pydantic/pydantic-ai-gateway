/** we're working with snake_case keys from the Groq API */

import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { DefaultProviderProxy } from './default'

export class GroqProvider extends DefaultProviderProxy {
  defaultBaseUrl = 'https://api.groq.com'

  protected modelAPI(): ModelAPI {
    const modelAPI = new ChatCompletionAPI('groq')
    // This is a workaround to make Groq models to work until we have a proper solution for this.
    // The solution probably lives in `genai-prices` - We should use `chat` flavor for Groq calls.
    modelAPI.apiFlavor = 'default'
    return modelAPI
  }
}
