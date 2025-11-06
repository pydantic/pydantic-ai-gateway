import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { DefaultProviderProxy } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected isWhitelistedEndpoint(): boolean {
    // If there is a query string, drop the query string from the path.
    const path = this.restOfPath.split('?')[0]
    // This endpoint is used by Claude Code.
    return path === 'v1/messages/count_tokens'
  }

  protected modelAPI(): ModelAPI {
    return new AnthropicAPI('anthropic')
  }

  // biome-ignore lint/suspicious/useAwait: required by google auth
  protected async requestHeaders(headers: Headers): Promise<void> {
    headers.set('x-api-key', this.providerProxy.credentials)
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    newHeaders.delete('anthropic-organization-id')
    return newHeaders
  }
}
