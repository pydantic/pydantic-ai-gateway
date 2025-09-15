import { InputMessages, Parts as InputParts } from '../otel/genai-input-messages'
import { OutputMessages } from '../otel/genai-output-messages'
import { DefaultProviderProxy } from './default'

// TODO(Marcelo): We use the beta API in PydanticAI, but does it matter here?
import type { MessageCreateParams, BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta'

export class AnthropicProvider extends DefaultProviderProxy {
  requestMaxTokens(requestBody: MessageCreateParams): number | undefined {
    return requestBody.max_tokens
  }

  responseFinishReasons(responseBody: BetaMessage): string[] | undefined {
    return responseBody.stop_reason ? [responseBody.stop_reason] : undefined
  }

  inputMessages(requestBody: MessageCreateParams): InputMessages | undefined {
    const messages: InputMessages = []

    for (const message of requestBody.messages) {
      messages.push({
        role: message.role,
        parts: mapInputParts(message.content),
      })
    }
    return messages
  }

  outputMessages(responseBody: BetaMessage): OutputMessages | undefined {
    console.log('outputMessages', responseBody)
    return undefined
  }
}

function mapInputParts(content: BetaMessageParam['content']): InputParts {
  const parts: InputParts = []

  if (typeof content === 'string') {
    parts.push({
      type: 'text',
      content,
    })
  } else {
    for (const part of content) {
      if ('type' in part && part.type === 'text') {
        parts.push({
          type: 'text',
          content: part.text,
        })
      } else {
        // TODO(Marcelo): Handle all the other part types
      }
    }
  }
  return parts
}
