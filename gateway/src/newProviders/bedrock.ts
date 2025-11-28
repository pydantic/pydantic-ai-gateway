import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { ConverseAPI } from '../api/bedrock'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ProviderOptions } from './base'

export class BedrockProvider extends BaseProvider {
  private flavor: 'default' | 'anthropic' = 'default'
  private requestModel: string | null = null
  private shouldStream: boolean = false

  constructor(options: ProviderOptions) {
    super(options)
    // Pre-analyze path to determine flavor and extract model
    this.analyzePath()
  }

  private analyzePath() {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Check if it's Anthropic format
    if (pathWithoutQuery === 'v1/messages') {
      this.flavor = 'anthropic'
    } else {
      // Try to extract model from path
      const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
      if (m) {
        const model = m[1]
        const api = m[2]

        // Detect Anthropic flavor from model name
        if (api === 'invoke' && model?.startsWith('anthropic.')) {
          this.flavor = 'anthropic'
        }
      }
    }
  }

  getModelAPI(): ModelAPI {
    if (this.flavor === 'anthropic') {
      return new AnthropicAPI('bedrock')
    }
    return new ConverseAPI('bedrock')
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }

  url(): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Handle Anthropic client format: v1/messages
    // Note: requestModel needs to be set from request body before calling url()
    if (pathWithoutQuery === 'v1/messages' && this.requestModel) {
      const path = `model/${this.requestModel}/${this.shouldStream ? 'invoke-with-response-stream' : 'invoke'}`
      return `${this.providerProxy.baseUrl}/${path}`
    }

    // Handle model extraction and replacement in existing paths
    const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
    if (m) {
      const model = m[1]
      const api = m[2]
      const newPath = this.restOfPath.replace(/model\/(.+?)\/(converse|invoke)/, `model/${model}/${api}`)
      return `${this.providerProxy.baseUrl}/${newPath}`
    }

    return super.url()
  }

  setRequestModel(model: string) {
    this.requestModel = model
  }

  setShouldStream(shouldStream: boolean) {
    this.shouldStream = shouldStream
  }
}
