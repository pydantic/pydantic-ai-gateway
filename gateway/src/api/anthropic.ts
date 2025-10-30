import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaRawMessageStreamEvent,
  MessageCreateParams,
} from '@anthropic-ai/sdk/resources/beta'
import type { InputMessages, JsonValue, MessagePart, OutputMessages, TextPart } from '../otel/genai'
import { BaseAPI, type ExtractedRequest, type ExtractedResponse, type ExtractorConfig } from './base'

export class AnthropicAPI extends BaseAPI<MessageCreateParams, BetaMessage, BetaRawMessageStreamEvent> {
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

  // SafeExtractor implementation

  requestExtractors: ExtractorConfig<MessageCreateParams, ExtractedRequest> = {
    requestModel: (requestBody: MessageCreateParams) => {
      this.extractedRequest.requestModel = requestBody.model ?? undefined
    },
    maxTokens: (requestBody: MessageCreateParams) => {
      this.extractedRequest.maxTokens = requestBody.max_tokens ?? undefined
    },
    temperature: (requestBody: MessageCreateParams) => {
      this.extractedRequest.temperature = requestBody.temperature ?? undefined
    },
    topK: (requestBody: MessageCreateParams) => {
      this.extractedRequest.topK = requestBody.top_k ?? undefined
    },
    topP: (requestBody: MessageCreateParams) => {
      this.extractedRequest.topP = requestBody.top_p ?? undefined
    },
    stopSequences: (requestBody: MessageCreateParams) => {
      this.extractedRequest.stopSequences = requestBody.stop_sequences ?? undefined
    },
    systemInstructions: (requestBody: MessageCreateParams) => {
      this.extractedRequest.systemInstructions = this.systemInstructions(requestBody)
    },
  }

  chunkExtractors: ExtractorConfig<BetaRawMessageStreamEvent, ExtractedResponse> = {
    usage: (chunk: BetaRawMessageStreamEvent) => {
      if ('usage' in chunk && chunk.usage) {
        this.extractedResponse.usage = this.extractUsage(chunk)
      }
    },
    responseModel: (chunk: BetaRawMessageStreamEvent) => {
      if (chunk.type === 'message_start') {
        this.extractedResponse.responseModel = chunk.message.model
      }
    },
    responseId: (chunk: BetaRawMessageStreamEvent) => {
      if (chunk.type === 'message_start') {
        this.extractedResponse.responseId = chunk.message.id
      }
    },
    finishReasons: (_chunk: BetaRawMessageStreamEvent) => {},
    // TODO(Marcelo): We should implement this one.
    outputMessages: (_chunk: BetaRawMessageStreamEvent) => {},
  }
}

function mapParts(content: string | BetaContentBlockParam[] | BetaContentBlock[]): MessagePart[] {
  const parts: MessagePart[] = []
  const mapToolCallIdToName: Record<string, string> = {}

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
        mapToolCallIdToName[part.id] = part.name
        parts.push({
          type: 'tool_call',
          id: part.id,
          name: part.name,
          arguments: part.input as JsonValue,
          builtin: part.type === 'server_tool_use',
        })
      } else if (
        part.type === 'tool_result' ||
        part.type === 'code_execution_tool_result' ||
        part.type === 'bash_code_execution_tool_result' ||
        part.type === 'text_editor_code_execution_tool_result' ||
        part.type === 'web_search_tool_result' ||
        part.type === 'web_fetch_tool_result'
      ) {
        parts.push({
          type: 'tool_call_response',
          id: part.tool_use_id,
          name: mapToolCallIdToName[part.tool_use_id],
          result: part.content as JsonValue,
          builtin: !(part.type === 'tool_result'),
        })
      } else {
        parts.push({ type: 'unknown', part: { ...part } })
      }
    }
  }
  return parts
}
