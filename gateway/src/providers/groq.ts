import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class GroqProvider extends BaseProvider {
  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
      return requestBodyData.model
    }
    return undefined
  }

  getModelAPI(_extracted: ExtractedInfo): ModelAPI {
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

  protected initializeAPIFlavor(): string | undefined {
    // Groq uses 'default' flavor - see workaround in getModelAPI()
    return 'default'
  }
}
