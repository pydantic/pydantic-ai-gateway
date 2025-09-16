import { InputMessages, JsonValue, MessagePart, OutputMessages, TextPart } from '../otel/genai'
import { DefaultProviderProxy } from './default'

// TODO(Marcelo): We use the beta API in PydanticAI, but does it matter here?
import type {
  MessageCreateParams,
  BetaMessage,
  BetaContentBlock,
  BetaContentBlockParam,
} from '@anthropic-ai/sdk/resources/beta'

export class AnthropicProvider extends DefaultProviderProxy {
  requestStopSequences(requestBody: MessageCreateParams): string[] | undefined {
    return requestBody.stop_sequences
  }

  requestTemperature(requestBody: MessageCreateParams): number | undefined {
    return requestBody.temperature
  }

  requestTopP(requestBody: MessageCreateParams): number | undefined {
    return requestBody.top_p
  }

  systemInstructions(requestBody: MessageCreateParams): TextPart[] | undefined {
    if (requestBody.system === undefined) {
      return undefined
    }

    if (typeof requestBody.system === 'string') {
      return [{ type: 'text', content: requestBody.system }]
    } else {
      return requestBody.system.map((part) => ({ type: 'text', content: part.text }))
    }
  }

  requestMaxTokens(requestBody: MessageCreateParams): number | undefined {
    return requestBody.max_tokens
  }

  responseFinishReasons(responseBody: BetaMessage): string[] | undefined {
    return responseBody.stop_reason ? [responseBody.stop_reason] : undefined
  }

  inputMessages(requestBody: MessageCreateParams): InputMessages | undefined {
    const messages: InputMessages = []

    for (const message of requestBody.messages) {
      messages.push({ role: message.role, parts: mapParts(message.content) })
    }
    return messages
  }

  outputMessages(_responseBody: BetaMessage): OutputMessages | undefined {
    return [
      {
        role: _responseBody.role,
        parts: mapParts(_responseBody.content),
        finish_reason: _responseBody.stop_reason ?? undefined,
      },
    ]
  }
}

function mapParts(content: string | BetaContentBlockParam[] | BetaContentBlock[]): MessagePart[] {
  const parts: MessagePart[] = []

  if (typeof content === 'string') {
    parts.push({ type: 'text', content })
  } else {
    for (const part of content) {
      if (part.type === 'text') {
        parts.push({ type: 'text', content: part.text })
      } else if (part.type === 'thinking') {
        parts.push({ type: 'thinking', content: part.thinking })
      } else if (part.type === 'image' && part.source.type === 'base64') {
        parts.push({ type: 'blob', mime_type: part.source.media_type, data: part.source.data })
      } else if (part.type === 'image' && part.source.type === 'url') {
        parts.push({ type: 'file_data', file_uri: part.source.url })
      } else if (part.type === 'tool_use') {
        parts.push({ type: 'tool_call', id: part.id, name: part.name, arguments: part.input as JsonValue })
      } else if (part.type === 'tool_result') {
        parts.push({ type: 'tool_call_response', id: part.tool_use_id, result: part.content as JsonValue })
      } else {
        parts.push({ ...part })
      }
    }
  }
  return parts
}
