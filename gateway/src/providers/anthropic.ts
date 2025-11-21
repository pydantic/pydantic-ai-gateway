import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { ChatCompletionAPI } from '../api/chat'
import { DefaultProviderProxy, type ProxyInvalidRequest } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected flavor: 'default' | 'chat' = 'default'

  // TODO(Marcelo): We should move this to the `DefaultProviderProxy` class.
  protected apiFlavor(): string | undefined {
    return this.flavor
  }

  protected isWhitelistedEndpoint(): boolean {
    // If there is a query string, drop the query string from the path.
    const path = this.restOfPath.split('?')[0]
    // This endpoint is used by Claude Code.
    return path === 'v1/messages/count_tokens'
  }

  protected modelAPI(): ModelAPI {
    if (this.flavor === 'chat') {
      return new ChatCompletionAPI('anthropic')
    } else {
      return new AnthropicAPI('anthropic')
    }
  }

  // biome-ignore lint/suspicious/useAwait: required by google auth
  protected async requestHeaders(headers: Headers): Promise<ProxyInvalidRequest | null> {
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    if (pathWithoutQuery === 'v1/chat/completions') {
      this.flavor = 'chat'
      headers.set('authorization', this.providerProxy.credentials)
    } else {
      headers.set('x-api-key', this.providerProxy.credentials)
    }

    return null
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    newHeaders.delete('anthropic-organization-id')
    return newHeaders
  }
}
