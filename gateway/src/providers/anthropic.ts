import { DefaultProviderProxy } from './default'

// TODO(Marcelo): We use the beta API in PydanticAI, but does it matter here?
import type { MessageCreateParams, BetaMessage } from '@anthropic-ai/sdk/resources/beta'

export class AnthropicProvider extends DefaultProviderProxy {
  requestMaxTokens(requestBody: MessageCreateParams): number | undefined {
    return requestBody.max_tokens
  }

  responseFinishReasons(responseBody: BetaMessage): string[] | undefined {
    return responseBody.stop_reason ? [responseBody.stop_reason] : undefined
  }

  inputMessages(requestBody: MessageCreateParams): unknown[] | undefined {
    console.log('inputMessages', requestBody)
    return requestBody.messages
  }

  outputMessages(responseBody: BetaMessage): unknown[] | undefined {
    return responseBody.content
  }
}
