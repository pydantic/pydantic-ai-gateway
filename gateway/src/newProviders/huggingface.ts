import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import type { ErrorResponse } from '../handler'
import { BaseProvider } from './base'

export class HuggingFaceProvider extends BaseProvider {
  getModelAPI(): ModelAPI {
    return new ChatCompletionAPI('huggingface')
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }
}
