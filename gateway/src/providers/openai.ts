import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import { EmbeddingsAPI } from '../api/embeddings'
import { ResponsesAPI } from '../api/responses'
import { DefaultProviderProxy, type Prepare, type ProxyInvalidRequest } from './default'

export class OpenAIProvider extends DefaultProviderProxy {
  flavor: 'chat' | 'responses' | 'embeddings' = 'chat'

  check() {
    if (this.restOfPath === 'embeddings') {
      this.flavor = 'embeddings'
    } else if (this.restOfPath === 'responses') {
      this.flavor = 'responses'
    } else if (this.restOfPath !== 'chat/completions') {
      return { error: 'invalid url, not chat/completions or responses endpoint' }
    }
  }

  apiFlavor(): string | undefined {
    return this.flavor
  }

  protected modelAPI(): ModelAPI {
    if (this.flavor === 'embeddings') {
      return new EmbeddingsAPI('openai')
    } else if (this.flavor === 'responses') {
      return new ResponsesAPI('openai')
    } else {
      return new ChatCompletionAPI('openai')
    }
  }

  protected async prepRequest(): Promise<ProxyInvalidRequest | Prepare> {
    const result = await super.prepRequest()
    if ('error' in result || this.flavor !== 'chat') {
      return result
    }

    const { requestBodyData, requestModel } = result

    const isStreaming = 'stream' in requestBodyData ? requestBodyData.stream : false
    if (!isStreaming) {
      return result
    }

    // If include_usage is already there, we don't need to inject it.
    let streamOptions = {}
    if ('stream_options' in requestBodyData) {
      streamOptions = requestBodyData.stream_options as Record<string, unknown>
    }
    if ('include_usage' in streamOptions) {
      if (streamOptions.include_usage === true) {
        return result
      } else {
        // The user intentionally disabled `include_usage`.
        return { error: 'You cannot disable `include_usage` in `stream_options`.' }
      }
    }

    const requestBodyDataClone = { ...requestBodyData, stream_options: { ...streamOptions, include_usage: true } }

    return {
      requestBodyText: JSON.stringify(requestBodyDataClone),
      requestBodyData: requestBodyDataClone,
      requestModel,
    }
  }

  protected responseHeaders(headers: Headers): Headers {
    const newHeaders = super.responseHeaders(headers)
    newHeaders.delete('openai-organization')
    newHeaders.delete('openai-project')
    return newHeaders
  }
}
