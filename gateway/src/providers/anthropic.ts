import { DefaultProviderProxy } from './default'
import { GenAiOtelEvent } from '../otelAttributes'

// TODO(Marcelo): We use the beta API in PydanticAI, but does it matter here?
import type { MessageCreateParams, BetaMessage } from '@anthropic-ai/sdk/resources/beta'

export class AnthropicProvider extends DefaultProviderProxy {
  otelEvents(_requestBody: MessageCreateParams, _responseBody: BetaMessage): GenAiOtelEvent[] {
    return []
  }
}
