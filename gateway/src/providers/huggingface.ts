import { findProvider, type Provider as UsageProvider } from '@pydantic/genai-prices'
import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { DefaultProviderProxy } from './default'

export class HuggingFaceProvider extends DefaultProviderProxy {
  // This provider refers to the provider that will be used to calculate the price.
  protected provider: string | null = null

  protected modelAPI(): ModelAPI {
    return new ChatCompletionAPI('huggingface', undefined, { usageProvider: this.usageProvider() })
  }

  apiFlavor(): string | undefined {
    return 'chat'
  }

  // We need to do this magic, because the `provider` is only set in the response headers.
  protected usageProvider(): UsageProvider | undefined {
    return findProvider({ providerId: `${this.providerId()}-${this.provider ?? 'unknown'}` })
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    this.provider = headers.get('x-inference-provider')
    return newHeaders
  }
}
