import { findProvider, type Provider as UsageProvider } from '@pydantic/genai-prices'
import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class HuggingFaceProvider extends BaseProvider {
  // HuggingFace routes to different providers (together, openai, etc)
  // We need to track which one was used to calculate the correct price
  private inferenceProvider: string | null = null

  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
      return requestBodyData.model
    }
    return undefined
  }

  getModelAPI(_extracted: ExtractedInfo): ModelAPI {
    return new ChatCompletionAPI('huggingface', undefined, { usageProvider: this.usageProvider() })
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }

  protected initializeAPIFlavor(): string | undefined {
    return 'chat'
  }

  filterResponseHeaders(headers: Headers): void {
    // Capture the inference provider for pricing purposes
    this.inferenceProvider = headers.get('x-inference-provider')
  }

  usageProvider(): UsageProvider | undefined {
    if (!this.inferenceProvider) return undefined
    return findProvider({ providerId: `${this.providerId()}-${this.inferenceProvider}` })
  }
}
