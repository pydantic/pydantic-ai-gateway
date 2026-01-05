import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { EmbeddingsAPI } from '../api/embeddings'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class OVHcloudProvider extends BaseProvider {
  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
      return requestBodyData.model
    }
    return undefined
  }

  getModelAPI(_extracted: ExtractedInfo): ModelAPI {
    switch (this.restOfPath) {
      case 'embeddings':
        return new EmbeddingsAPI('ovhcloud')
      default:
        return new ChatCompletionAPI('ovhcloud')
    }
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }

  protected initializeAPIFlavor(): string | undefined {
    switch (this.restOfPath) {
      case 'embeddings':
        return 'embeddings'
      default:
        return 'chat'
    }
  }

  requestBody(extracted: ExtractedInfo): ExtractedInfo | ErrorResponse {
    // Only modify for chat completions
    if (this.restOfPath !== 'chat/completions') {
      return extracted
    }

    const { requestBodyData } = extracted

    // Only modify if streaming is enabled
    const isStreaming = 'stream' in requestBodyData && requestBodyData.stream === true
    if (!isStreaming) {
      return extracted
    }

    // Check if stream_options already exists
    let streamOptions = {}
    if ('stream_options' in requestBodyData) {
      streamOptions = requestBodyData.stream_options as Record<string, unknown>
    }

    // If include_usage is already set, validate it
    if ('include_usage' in streamOptions) {
      if (streamOptions.include_usage === true) {
        return extracted
      }
      // User tried to disable include_usage
      return { error: 'You cannot disable `include_usage` in `stream_options`.' }
    }

    // Inject include_usage: true
    const requestBodyDataClone = { ...requestBodyData, stream_options: { ...streamOptions, include_usage: true } }

    return { requestBodyText: JSON.stringify(requestBodyDataClone), requestBodyData: requestBodyDataClone }
  }
}
