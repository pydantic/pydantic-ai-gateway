import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { EmbeddingsAPI } from '../api/embeddings'
import { ResponsesAPI } from '../api/responses'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class OpenAIProvider extends BaseProvider {
  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
      return requestBodyData.model
    }
    return undefined
  }

  getModelAPI(extracted: ExtractedInfo): ModelAPI {
    switch (this.restOfPath) {
      case 'embeddings':
        return new EmbeddingsAPI('openai')
      case 'responses':
        return new ResponsesAPI('openai')
      default:
        return new ChatCompletionAPI('openai')
    }
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }
}
