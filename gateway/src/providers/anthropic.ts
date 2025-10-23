import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import type { GenAIAttributes } from '../otel/attributes'
import type { JsonData } from './default'
import { DefaultProviderProxy } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected modelAPI(): ModelAPI | undefined {
    return new AnthropicAPI()
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
  protected async extractUsage(response: Response) {
    // Special handling for count_tokens endpoint
    // Ref: https://docs.claude.com/en/docs/build-with-claude/token-counting
    // Response format: { "input_tokens": number }
    if (this.restOfPath === 'v1/messages/count_tokens') {
      const bodyText = await response.text()
      try {
        const responseBody = JSON.parse(bodyText) as JsonData

        if ('input_tokens' in responseBody && typeof responseBody.input_tokens === 'number') {
          return {
            responseBody,
            responseModel: 'token-counting',
            usage: { input_tokens: responseBody.input_tokens as number, output_tokens: 0 },
            cost: 0,
          }
        }
        return { error: 'Invalid count_tokens response format' }
      } catch {
        return { error: 'Failed to parse count_tokens response' }
      }
    }

    return super.extractUsage(response)
  }
  protected otelAttributes(requestBody: JsonData, responseBody: JsonData): GenAIAttributes {
    // count_tokens responses don't have the same structure as messages,
    // so we return empty attributes for this endpoint
    if (this.restOfPath === 'v1/messages/count_tokens') {
      return {}
    }

    return super.otelAttributes(requestBody, responseBody)
  }
}
