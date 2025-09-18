import { InputMessages, JsonValue, MessagePart, OutputMessages, TextPart } from '../otel/genai'
import { DefaultProviderProxy } from './default'

// TODO(Marcelo): We use the beta API in PydanticAI, but does it matter here?
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  MessageCreateParams,
} from '@anthropic-ai/sdk/resources/beta'

export class AnthropicProvider extends DefaultProviderProxy<MessageCreateParams, BetaMessage> {
  requestStopSequences = (requestBody: MessageCreateParams): string[] | undefined => requestBody.stop_sequences
  requestTemperature = (requestBody: MessageCreateParams): number | undefined => requestBody.temperature
  requestTopK = (requestBody: MessageCreateParams): number | undefined => requestBody.top_k
  requestTopP = (requestBody: MessageCreateParams): number | undefined => requestBody.top_p
  requestMaxTokens = (requestBody: MessageCreateParams): number | undefined => requestBody.max_tokens
  responseId = (responseBody: BetaMessage): string | undefined => responseBody.id

  systemInstructions = (requestBody: MessageCreateParams): TextPart[] | undefined => {
    if (requestBody.system === undefined) {
      return undefined
    }

    if (typeof requestBody.system === 'string') {
      return [{ type: 'text', content: requestBody.system }]
    } else {
      return requestBody.system.map((part) => ({ type: 'text', content: part.text }))
    }
  }

  responseFinishReasons = (responseBody: BetaMessage): string[] | undefined => {
    return responseBody.stop_reason ? [responseBody.stop_reason] : undefined
  }

  inputMessages = (requestBody: MessageCreateParams): InputMessages | undefined => {
    const messages: InputMessages = []

    for (const message of requestBody.messages) {
      messages.push({ role: message.role, parts: mapParts(message.content) })
    }
    return messages
  }

  outputMessages = (responseBody: BetaMessage): OutputMessages | undefined => {
    return [
      {
        role: responseBody.role,
        parts: mapParts(responseBody.content),
        finish_reason: responseBody.stop_reason ?? undefined,
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
        // TODO(Marcelo): Currently, there's no semantic convention for built-in tools: https://github.com/open-telemetry/semantic-conventions/issues/2585
      } else if (part.type === 'tool_use' || part.type === 'server_tool_use') {
        parts.push({ type: 'tool_call', id: part.id, name: part.name, arguments: part.input as JsonValue })
      } else if (
        part.type === 'tool_result' ||
        part.type === 'code_execution_tool_result' ||
        part.type === 'bash_code_execution_tool_result' ||
        part.type === 'text_editor_code_execution_tool_result' ||
        part.type === 'web_search_tool_result' ||
        part.type === 'web_fetch_tool_result'
      ) {
        parts.push({ type: 'tool_call_response', id: part.tool_use_id, result: part.content as JsonValue })
      } else {
        parts.push({ ...part })
      }
    }
  }
  return parts
}
