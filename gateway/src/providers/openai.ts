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

    if (!('stream' in requestBodyData)) {
      return result
    }

    // If it's a stream request, we need to inject the `stream_options` key if it's not present.
    const requestBodyDataClone = { ...(requestBodyData as Record<string, unknown>) }
    const streamOptions = (requestBodyDataClone?.stream_options || {}) as Record<string, unknown>

    if (!('include_usage' in streamOptions)) {
      streamOptions.include_usage = true
    }

    requestBodyDataClone.stream_options = streamOptions

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
