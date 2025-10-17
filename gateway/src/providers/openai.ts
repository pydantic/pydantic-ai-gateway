import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { ResponsesAPI } from '../api/responses'
import { DefaultProviderProxy } from './default'

export class OpenAIProvider extends DefaultProviderProxy {
  flavor: 'chat' | 'responses' = 'chat'

  check() {
    if (this.restOfPath === 'responses') {
      this.flavor = 'responses'
    } else if (this.restOfPath !== 'chat/completions') {
      return { error: 'invalid url, not chat/completions or responses endpoint' }
    }
  }

  apiFlavor(): string | undefined {
    return this.flavor
  }

  modelAPI(): ModelAPI | undefined {
    if (this.flavor === 'responses') {
      return new ResponsesAPI()
    } else {
      return new ChatCompletionAPI()
    }
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    newHeaders.delete('openai-organization')
    newHeaders.delete('openai-project')
    return newHeaders
  }
}
