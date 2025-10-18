import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { DefaultProviderProxy } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected modelAPI(): ModelAPI | undefined {
    return new AnthropicAPI()
  }
  // biome-ignore lint/suspicious/useAwait: method overrides base class
  protected async requestHeaders(headers: Headers): Promise<void> {
    headers.set('x-api-key', this.providerProxy.credentials)
    if (!headers.has('anthropic-version')) {
      headers.set('anthropic-version', '2023-06-01')
    }
  }
}
