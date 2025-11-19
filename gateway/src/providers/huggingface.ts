import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { DefaultProviderProxy } from './default'

export class HuggingFaceProvider extends DefaultProviderProxy {
  defaultBaseUrl = 'https://api-inference.huggingface.co'

  protected modelAPI(): ModelAPI {
    return new ChatCompletionAPI('huggingface')
  }
}
