/** we're working with snake_case keys from the Groq API */

import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { DefaultProviderProxy } from './default'

export class GroqProvider extends DefaultProviderProxy {
  defaultBaseUrl = 'https://api.groq.com'

  protected modelAPI(): ModelAPI | undefined {
    return new ChatCompletionAPI('groq')
  }
}
