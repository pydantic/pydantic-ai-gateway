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

  protected modelAPI(): ModelAPI {
    // TODO(Marcelo): We need to add test for this when `genai-prices` supports Anthropic through Bedrock.
    if (this.flavor === 'anthropic') {
      return new AnthropicAPI('bedrock')
    }
    return new ConverseAPI('bedrock')
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData: JsonData
    try {
      requestBodyData = JSON.parse(requestBodyText)
    } catch (_error) {
      return { error: 'invalid request JSON' }
    }

    let requestModel: string | null = null
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    if (pathWithoutQuery === 'v1/messages') {
      this.flavor = 'anthropic'
      if (!('model' in requestBodyData)) {
        return { error: 'model not found in Anthropic request body' }
      }
      requestModel = requestBodyData.model as string
    } else {
      requestModel = this.inferModel(this.restOfPath)
      if (!requestModel) {
        return { error: 'unable to find model in path' }
      }
    }
    return { requestBodyText, requestBodyData, requestModel }
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
