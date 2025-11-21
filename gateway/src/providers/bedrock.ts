import logfire from 'logfire'
import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { ConverseAPI } from '../api/bedrock'
import { DefaultProviderProxy, type JsonData } from './default'

export class BedrockProvider extends DefaultProviderProxy {
  // We are calling it 'default', but we could also call it 'converse'.
  // The most correct would be 'invoke' instead of 'anthropic', but then we wouldn't be able to differentiate
  // between others like Chat Completions API.
  flavor: 'default' | 'anthropic' = 'default'

  // NOTE: This should be moved to the `DefaultProviderProxy` class.
  protected shouldStream: boolean = false

  url() {
    if (this.providerProxy.baseUrl) {
      const pathWithoutQuery = this.restOfPath.split('?')[0]
      if (pathWithoutQuery === 'v1/messages' && this.requestModel) {
        const model = this.replaceModel(this.requestModel)
        // TODO(Marcelo): We need to test this!
        const path = `model/${model}/${this.shouldStream ? 'invoke-with-response-stream' : 'invoke'}`
        return `${this.providerProxy.baseUrl}/${path}`
      } else {
        // Extract model and API endpoint from path, apply replacement, and rebuild URL
        const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
        if (m) {
          const model = m[1]
          const api = m[2]
          const replacedModel = model && this.replaceModel(model)
          const newPath = this.restOfPath.replace(/model\/(.+?)\/(converse|invoke)/, `model/${replacedModel}/${api}`)
          return `${this.providerProxy.baseUrl}/${newPath}`
        }
        return `${this.providerProxy.baseUrl}/${this.restOfPath}`
      }
    } else {
      return { error: 'baseUrl is required for Bedrock Provider' }
    }
  }

  protected getModelNameRemappings(): { searchValue: string; replaceValue: string }[] {
    return []
  }

  protected modelAPI(): ModelAPI {
    // TODO(Marcelo): We need to add test for this when `genai-prices` supports Anthropic through Bedrock.
    if (this.flavor === 'anthropic') {
      return new AnthropicAPI('bedrock')
    }
    return new ConverseAPI('bedrock')
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData: JsonData & { anthropic_version?: string }
    try {
      requestBodyData = JSON.parse(requestBodyText)
    } catch (_error) {
      return { error: 'invalid request JSON' }
    }

    const pathWithoutQuery = this.restOfPath.split('?')[0]
    if (pathWithoutQuery === 'v1/messages') {
      this.flavor = 'anthropic'
      if (!('model' in requestBodyData)) {
        return { error: 'model not found in Anthropic request body' }
      }
      this.requestModel = requestBodyData.model as string

      if (!('anthropic_version' in requestBodyData)) {
        requestBodyData.anthropic_version = 'bedrock-2023-05-31'
      }

      // TODO(Marcelo): Add a test for streaming.
      if ('stream' in requestBodyData) {
        if (requestBodyData.stream === true) {
          this.shouldStream = true
        }
        delete requestBodyData.stream
      }

      // Remove the model from the request body since Bedrock doesn't expect it
      delete requestBodyData.model

      // Update requestBodyText without the model field
      const updatedRequestBodyText = JSON.stringify(requestBodyData)

      return { requestBodyText: updatedRequestBodyText, requestBodyData, requestModel: this.requestModel }
    } else {
      this.requestModel = this.inferModel(this.restOfPath)
      if (!this.requestModel) {
        return { error: 'unable to find model in path' }
      }
      return { requestBodyText, requestBodyData, requestModel: this.requestModel }
    }
  }

  /**
   * Infer the model from the URL.
   * It can either be the Converse API or the Invoke API.
   * @param url - The URL to infer the model from.
   * @returns The model or null if it cannot be inferred.
   */
  protected inferModel(url: string): string | null {
    const m = url.match(/model\/(.+?)\/(converse|invoke)/)
    let model = m?.[1]
    const api = m?.[2]

    if (typeof model === 'string') {
      // Do the substitution first here so that we can insert the `anthropic.` that we look for below if we want to
      model = this.replaceModel(model)
    }

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
