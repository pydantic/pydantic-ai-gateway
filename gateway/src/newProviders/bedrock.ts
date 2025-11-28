import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { ConverseAPI } from '../api/bedrock'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class BedrockProvider extends BaseProvider {
  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // For v1/messages format, get model from body
    if (pathWithoutQuery === 'v1/messages') {
      if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
        return requestBodyData.model
      }
    } else {
      // Try to extract model from URL path: model/{model}/(converse|invoke)
      const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
      if (m) {
        return m[1]
      }
    }

    return undefined
  }

  getModelAPI(extracted: ExtractedInfo): ModelAPI {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Check if it's Anthropic format from path
    if (pathWithoutQuery === 'v1/messages') {
      return new AnthropicAPI('bedrock')
    }

    // Check if model name indicates Anthropic
    const requestModel = this.getRequestModel(extracted)
    if (requestModel?.startsWith('anthropic.')) {
      return new AnthropicAPI('bedrock')
    }

    return new ConverseAPI('bedrock')
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }

  url(extracted: ExtractedInfo): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    const { requestBodyData } = extracted

    // Handle Anthropic client format: v1/messages
    if (pathWithoutQuery === 'v1/messages') {
      const requestModel = this.getRequestModel(extracted)
      if (requestModel) {
        const shouldStream = 'stream' in requestBodyData && requestBodyData.stream === true
        const path = `model/${requestModel}/${shouldStream ? 'invoke-with-response-stream' : 'invoke'}`
        return `${this.providerProxy.baseUrl}/${path}`
      }
    }

    // Handle model extraction in existing paths
    const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
    if (m) {
      const model = m[1]
      const api = m[2]
      const newPath = this.restOfPath.replace(/model\/(.+?)\/(converse|invoke)/, `model/${model}/${api}`)
      return `${this.providerProxy.baseUrl}/${newPath}`
    }

    return super.url(extracted)
  }
}
