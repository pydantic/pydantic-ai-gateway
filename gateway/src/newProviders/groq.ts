import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import type { ErrorResponse } from '../handler'
import { BaseProvider } from './base'

export class GroqProvider extends BaseProvider {
  getModelAPI(): ModelAPI {
    const modelAPI = new ChatCompletionAPI('groq')
    // This is a workaround to make Groq models to work until we have a proper solution for this.
    // The solution probably lives in `genai-prices` - We should use `chat` flavor for Groq calls.
    modelAPI.apiFlavor = 'default'
    return modelAPI
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }
}
