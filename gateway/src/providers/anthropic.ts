import { extractUsage } from '@pydantic/genai-prices'
import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { DefaultProviderProxy, type JsonData } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected isWhitelistedEndpoint(): boolean {
    // This endpoint is used by Claude Code.
    return this.restOfPath === 'v1/messages/count_tokens'
  }

  protected modelAPI(): ModelAPI | undefined {
    return new AnthropicAPI('anthropic')
  }

  // biome-ignore lint/suspicious/useAwait: required by google auth
  protected async requestHeaders(headers: Headers): Promise<void> {
    headers.set('x-api-key', this.providerProxy.credentials)
  }

  // TODO(Marcelo): This should be moved to the `ModelAPI` class, and we need to improve the typing here!
  protected handleData(data: JsonData) {
    if ('type' in data && data.type === 'message_start') {
      const message = 'message' in data ? (data.message as JsonData) : undefined
      if (message) {
        const model = 'model' in message ? (message.model as string) : undefined
        if (model) {
          this.responseModel = model
        }
      }
    }
    if ('usage' in data) {
      const { usage } = extractUsage(this.usageProvider()!, data, this.apiFlavor())
      this.usage = usage
    }
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    newHeaders.delete('anthropic-organization-id')
    return newHeaders
  }
}
