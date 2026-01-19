import { AnthropicProvider } from './anthropic'
import type { BaseProvider, ProviderOptions } from './base'
import { OpenAIProvider } from './openai'

export function createAzureProvider(options: ProviderOptions): BaseProvider {
  // We assume that it's Anthropic if the path starts with `v1/messages`. Otherwise, it's OpenAI.
  // This is not necessarily true, since Anthropic does support OpenAI-compatible endpoints.
  const isAnthropic = options.restOfPath.startsWith('v1/messages')

  // We modify the `baseUrl` and not the `restOfPath` because the `restOfPath` is used to determine the API flavor.
  // NOTE: Instead of modifying the `provierProxy` object, I think we should pass the `baseUrl` as a separate argument to the constructor.
  const modifiedOptions: ProviderOptions = {
    ...options,
    providerProxy: {
      ...options.providerProxy,
      baseUrl: isAnthropic
        ? `${options.providerProxy.baseUrl}/anthropic`
        : `${options.providerProxy.baseUrl}/openai/v1`,
    },
  }

  return isAnthropic ? new AnthropicProvider(modifiedOptions) : new OpenAIProvider(modifiedOptions)
}
