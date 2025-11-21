/** This module implements the OpenAI Responses API.
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import logfire from 'logfire'
import type {
  Response,
  ResponseCreateParams,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import { match, P } from 'ts-pattern'
import type { ChatMessage, InputMessages, MessagePart, OutputMessage, OutputMessages } from '../otel/genai'
import { BaseAPI, type ExtractedRequest, type ExtractedResponse, type ExtractorConfig } from './base'

export class ResponsesAPI extends BaseAPI<ResponseCreateParams, Response, ResponseStreamEvent> {
  apiFlavor = 'responses'

  // The Responses API does not support stop sequences.
  requestStopSequences = (_requestBody: ResponseCreateParams): string[] | undefined => undefined

  requestTemperature = (requestBody: ResponseCreateParams): number | undefined => {
    return requestBody.temperature ?? undefined
  }

  requestTopP = (requestBody: ResponseCreateParams): number | undefined => {
    return requestBody.top_p ?? undefined
  }

  requestMaxTokens = (requestBody: ResponseCreateParams): number | undefined => {
    return requestBody.max_output_tokens ?? undefined
  }

  responseId = (responseBody: Response): string | undefined => responseBody.id

  responseFinishReasons = (responseBody: Response): string[] | undefined => {
    return responseBody.incomplete_details?.reason ? [responseBody.incomplete_details.reason] : undefined
  }

  inputMessages = (requestBody: ResponseCreateParams): InputMessages | undefined => {
    if (typeof requestBody.input === 'string') {
      return [{ role: 'user', parts: [{ type: 'text', content: requestBody.input }] }]
    }
    return requestBody.input.map(mapInputMessage)
  }

  outputMessages = (responseBody: Response): OutputMessages | undefined => {
    return [mapOutputMessage(responseBody.output)]
  }

  // SafeExtractor implementation

  requestExtractors: ExtractorConfig<ResponseCreateParams, ExtractedRequest> = {
    requestModel: (requestBody: ResponseCreateParams) => {
      this.extractedRequest.requestModel = requestBody.model ?? undefined
    },
    maxTokens: (requestBody: ResponseCreateParams) => {
      this.extractedRequest.maxTokens = requestBody.max_output_tokens ?? undefined
    },
    temperature: (requestBody: ResponseCreateParams) => {
      this.extractedRequest.temperature = requestBody.temperature ?? undefined
    },
    topP: (requestBody: ResponseCreateParams) => {
      this.extractedRequest.topP = requestBody.top_p ?? undefined
    },
    inputMessages: (requestBody: ResponseCreateParams) => {
      this.extractedRequest.inputMessages = this.inputMessages(requestBody)
    },
  }

  responseExtractors: ExtractorConfig<Response, ExtractedResponse> = {
    usage: (responseBody: Response) => {
      if (responseBody.usage) {
        this.extractedResponse.usage = this.extractUsage(responseBody)
      }
    },
    responseModel: (responseBody: Response) => {
      this.extractedResponse.responseModel = responseBody.model ?? undefined
    },
    responseId: (responseBody: Response) => {
      this.extractedResponse.responseId = responseBody.id ?? undefined
    },
    finishReasons: (responseBody: Response) => {
      this.extractedResponse.finishReasons = responseBody.incomplete_details?.reason
        ? [responseBody.incomplete_details.reason]
        : undefined
    },
    outputMessages: (responseBody: Response) => {
      this.extractedResponse.outputMessages = [mapOutputMessage(responseBody.output)]
    },
  }

  chunkExtractors: ExtractorConfig<ResponseStreamEvent, ExtractedResponse> = {
    usage: (chunk: ResponseStreamEvent) => {
      if ('response' in chunk) {
        if (chunk.response?.usage) {
          this.extractedResponse.usage = this.extractUsage(chunk.response)
        }
      }
    },
    responseModel: (chunk: ResponseStreamEvent) => {
      if ('response' in chunk) {
        if (chunk.response?.model) {
          this.extractedResponse.responseModel = chunk.response.model
        }
      }
    },
    responseId: (chunk: ResponseStreamEvent) => {
      if ('response' in chunk) {
        if (chunk.response?.id) {
          this.extractedResponse.responseId = chunk.response.id
        }
      }
    },
    finishReasons: (chunk: ResponseStreamEvent) => {
      if ('response' in chunk) {
        if (chunk.response?.incomplete_details?.reason) {
          this.extractedResponse.finishReasons = [chunk.response.incomplete_details.reason]
        }
      }
    },
  }
}

function mapInputMessage(input: ResponseInputItem): ChatMessage {
  return (
    match(input)
      .returnType<ChatMessage>()
      // Handle `EasyInputMessage` content.
      .with({ type: 'message', content: P.string }, (_input) => {
        return {
          role: _input.role === 'developer' ? 'system' : _input.role,
          parts: [{ type: 'text', content: _input.content }],
        }
      })
      // Handle `ResponseOutputMessage` content.
      .with({ type: 'message', content: P.array(P.union({ type: 'output_text' }, { type: 'refusal' })) }, (_input) => {
        return {
          role: _input.role,
          parts: _input.content.map((part) => {
            return (
              match(part)
                .returnType<MessagePart>()
                .with({ type: 'output_text' }, (_part) => {
                  return { type: 'text', content: _part.text }
                })
                // TODO(Marcelo): How do we represent refusals?
                .with({ type: 'refusal' }, (_part) => {
                  return { type: 'unknown', part: { ..._part } }
                })
                .exhaustive()
            )
          }),
        }
      })
      // Handle `ResponseInputMessage` content.
      .with({ type: 'message', content: P.array() }, (_input) => {
        return {
          role: _input.role === 'developer' ? 'system' : _input.role,
          parts: _input.content.map((part) => {
            return (
              match(part)
                .returnType<MessagePart>()
                .with({ type: 'input_text' }, (_part) => {
                  return { type: 'text', content: _part.text }
                })
                // TODO(Marcelo): We should handle this after we replace the GenAI Blob/File parts.
                .with({ type: 'input_file' }, (_part) => {
                  return { type: 'unknown', part: { ..._part } }
                })
                .with({ type: 'input_image' }, (_part) => {
                  if (_part.image_url) {
                    return { type: 'file_data', file_uri: _part.image_url }
                  } else if (_part.file_id) {
                    return { type: 'file_data', file_uri: _part.file_id }
                  } else {
                    return { type: 'unknown', part: { ..._part } }
                  }
                })
                .exhaustive()
            )
          }),
        }
      })
      .with({ type: 'function_call' }, (_input) => {
        return {
          role: 'assistant',
          parts: [{ type: 'tool_call', id: _input.call_id, name: _input.name, arguments: _input.arguments }],
        }
      })
      .with({ type: 'function_call_output' }, (_input) => {
        return { role: 'user', parts: [{ type: 'tool_call_response', id: _input.call_id, result: _input.output }] }
      })
      .with({ type: 'reasoning' }, (_input) => {
        return {
          role: 'assistant',
          parts: _input.summary.map((summary) => ({ type: 'thinking', content: summary.text })),
        }
      })
      // TODO(Marcelo): If we want to display them in a pretty way in the Logfire UI, we need to handle them properly.
      .with(
        P.union(
          { type: 'file_search_call' },
          // The `ImageGenerationCall` has a base64 encoded image in the `result` field.
          { type: 'image_generation_call' },
          { type: 'web_search_call' },
          { type: 'code_interpreter_call' },
          { type: 'local_shell_call' },
          { type: 'local_shell_call_output' },
          { type: 'computer_call' },
          { type: 'computer_call_output' },
          // MCP related types.
          { type: 'mcp_list_tools' },
          { type: 'mcp_approval_request' },
          { type: 'mcp_approval_response' },
          { type: 'mcp_call' },
          { type: 'item_reference' },
        ),
        (_input) => {
          return { role: 'assistant', parts: [{ type: 'unknown', part: { ..._input } }] }
        },
      )
      .with({ content: P.string }, (_input) => {
        return {
          role: _input.role === 'developer' ? 'system' : _input.role,
          parts: [{ type: 'text', content: _input.content }],
        }
      })
      .otherwise(() => {
        logfire.warning('unexpected input type', { input })
        return { role: 'user', parts: [{ type: 'unknown', part: { ...input } }] }
      })
  )
}

function mapOutputMessage(output: ResponseOutputItem[]): OutputMessage {
  return { role: 'assistant', parts: mapOutputParts(output) }
}

function mapOutputParts(output: ResponseOutputItem[]): MessagePart[] {
  const parts: MessagePart[] = []

  for (const item of output) {
    match(item)
      .with({ type: 'reasoning' }, (item) => {
        parts.push({ type: 'thinking' as const, content: item.summary.join('\n') })
      })
      .with({ content: P.array(P.union({ type: 'output_text' }, { type: 'refusal' })) }, (_item) => {
        parts.push(
          ..._item.content.map((part) => {
            return match(part)
              .returnType<MessagePart>()
              .with({ type: 'output_text' }, (_part) => {
                return { type: 'text', content: _part.text }
              })
              .with({ type: 'refusal' }, (_part) => {
                return { type: 'unknown', part: { ..._part } }
              })
              .exhaustive()
          }),
        )
      })
      .with({ type: 'function_call' }, (_item) => {
        parts.push({ type: 'tool_call', id: _item.call_id, name: _item.name, arguments: _item.arguments })
      })
      .with(
        P.union(
          { type: 'file_search_call' },
          { type: 'code_interpreter_call' },
          { type: 'image_generation_call' },
          { type: 'local_shell_call' },
          { type: 'computer_call' },
          { type: 'mcp_call' },
          { type: 'mcp_list_tools' },
          { type: 'mcp_approval_request' },
          { type: 'web_search_call' },
        ),
        (_item) => {
          parts.push({ type: 'unknown', part: { ..._item } })
        },
      )
      .exhaustive()
  }

  return parts
}
