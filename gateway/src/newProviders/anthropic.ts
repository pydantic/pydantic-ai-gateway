import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { ChatCompletionAPI } from '../api/chat'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class AnthropicProvider extends BaseProvider {
  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
      return requestBodyData.model
    }
    return undefined
  }

  getModelAPI(extracted: ExtractedInfo): ModelAPI {
    if (this.restOfPath.split('?')[0] === 'v1/chat/completions') {
      return new ChatCompletionAPI('anthropic')
    } else {
      return new AnthropicAPI('anthropic')
    }
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    if (pathWithoutQuery === 'v1/chat/completions') {
      headers.set('authorization', this.providerProxy.credentials)
    } else {
      headers.set('x-api-key', this.providerProxy.credentials)
    }

    return Promise.resolve(null)
  }
}
