import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { DefaultProviderProxy } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected modelAPI(): ModelAPI | undefined {
    return new AnthropicAPI()
  }

  protected requestHeaders(headers: Headers): void {
    headers.set('x-api-key', this.providerProxy.credentials)
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    newHeaders.delete('anthropic-organization-id')
    return newHeaders
  }
}
