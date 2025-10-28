
import * as logfire from '@pydantic/logfire-api'
import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { ConverseAPI } from '../api/bedrock'
import { DefaultProviderProxy, type JsonData } from './default'

export class BedrockProvider extends DefaultProviderProxy {
  // We are calling it 'default', but we could also call it 'converse'.
  // The most correct would be 'invoke' instead of 'anthropic', but then we wouldn't be able to differentiate
  // between others like Chat Completions API.
  flavor: 'default' | 'anthropic' = 'default'

  protected modelAPI(): ModelAPI | undefined {
    // TODO(Marcelo): We need to add test for this when `genai-prices` supports Anthropic through Bedrock.
    if (this.flavor === 'anthropic') {
      return new AnthropicAPI('bedrock')
    } else {
      return new ConverseAPI('bedrock')
    }
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData: JsonData
    try {
      requestBodyData = JSON.parse(requestBodyText)
    } catch (_error) {
      return { error: 'invalid request JSON' }
    }
    const m = this.inferModel(this.restOfPath)
    if (m) {
      return { requestBodyText, requestBodyData, requestModel: m[1] }
    }
    return { error: 'unable to find model in path' }
  }

  /**
   * Infer the model from the URL.
   * It can either be the Converse API or the Invoke API.
   * @param url - The URL to infer the model from.
   * @returns The model or null if it cannot be inferred.
   */
  protected inferModel(url: string): string | null {
    const m = url.match(/model\/(.+?)\/(converse|invoke)/)
    const model = m?.[1]
    const api = m?.[2]

    if (api === 'invoke' && model?.startsWith('anthropic.')) {
      this.flavor = 'anthropic'
    }

    return model ?? null
  }

  inferResponseModel(): string | null {
    // We need to decode the rest of the path because it may contain encoded characters like "%3A" (:).
    try {
      const decodedRestOfPath = decodeURIComponent(this.restOfPath)
      return this.inferModel(decodedRestOfPath)
    } catch (error) {
      logfire.reportError('Error decoding URI', error as Error)
      return null
    }
  }
}
