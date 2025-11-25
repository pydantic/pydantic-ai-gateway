import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { DefaultProviderProxy } from './default'

export class HuggingFaceProvider extends DefaultProviderProxy {
  defaultBaseUrl = 'https://router.huggingface.co/v1'

  protected modelAPI(): ModelAPI {
    return new ChatCompletionAPI('huggingface')
  }
}
