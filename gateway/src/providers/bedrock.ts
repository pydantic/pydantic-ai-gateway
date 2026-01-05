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
      // Need to decode the path because it may contain encoded characters like "%3A" (:)
      try {
        const decodedPath = decodeURIComponent(this.restOfPath)
        const m = decodedPath.match(/model\/(.+?)\/(converse|invoke)/)
        if (m) {
          return m[1]
        }
      } catch {
        // If decoding fails, try without decoding
        const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
        if (m) {
          return m[1]
        }
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

  protected initializeAPIFlavor(): string | undefined {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Anthropic format through Bedrock
    if (pathWithoutQuery === 'v1/messages') {
      return 'anthropic'
    }

    // Check if it's invoke API with anthropic model
    // Need to decode the path because it may contain encoded characters
    try {
      const decodedPath = decodeURIComponent(this.restOfPath)
      const m = decodedPath.match(/model\/(.+?)\/(converse|invoke)/)
      if (m) {
        const api = m[2]
        const model = m[1]
        if (api === 'invoke' && model?.startsWith('anthropic.')) {
          return 'anthropic'
        }
      }
    } catch {
      // If decoding fails, try without decoding
      const m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
      if (m) {
        const api = m[2]
        const model = m[1]
        if (api === 'invoke' && model?.startsWith('anthropic.')) {
          return 'anthropic'
        }
      }
    }

    // Default is converse
    return 'default'
  }

  requestBody(extracted: ExtractedInfo): ExtractedInfo | ErrorResponse {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Handle Anthropic client format: v1/messages
    if (pathWithoutQuery === 'v1/messages') {
      const { requestBodyData } = extracted

      // Add anthropic_version if not present
      const modified = { ...requestBodyData } as Record<string, unknown>
      if (!('anthropic_version' in modified)) {
        modified.anthropic_version = 'bedrock-2023-05-31'
      }

      // Remove stream field (Bedrock doesn't expect it)
      if ('stream' in modified) {
        delete modified.stream
      }

      // Remove model field (Bedrock doesn't expect it)
      delete modified.model

      return { requestBodyText: JSON.stringify(modified), requestBodyData: modified }
    }

    return extracted
  }

  url(extracted: ExtractedInfo, requestModel?: string): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    const { requestBodyData } = extracted

    // Handle Anthropic client format: v1/messages
    if (pathWithoutQuery === 'v1/messages') {
      if (requestModel) {
        const shouldStream = 'stream' in requestBodyData && requestBodyData.stream === true
        const model = this.replaceModel(requestModel)
        console.log('model', model)
        const path = `model/${model}/${shouldStream ? 'invoke-with-response-stream' : 'invoke'}`
        console.log('path', path)
        return `${this.providerProxy.baseUrl}/${path}`
      }
    } else {
      // Handle model extraction in existing paths
      // Need to decode the path because it may contain encoded characters like "%3A" (:)
      let path: string | undefined
      let m: RegExpMatchArray | null = null
      try {
        path = decodeURIComponent(this.restOfPath)
        m = path.match(/model\/(.+?)\/(converse|invoke)/)
      } catch {
        path = this.restOfPath
        m = this.restOfPath.match(/model\/(.+?)\/(converse|invoke)/)
      }
      if (m) {
        const model = m[1] && this.replaceModel(m[1])
        const api = m[2]
        const newPath = path.replace(/model\/(.+?)\/(converse|invoke)/, `model/${model}/${api}`)
        return `${this.providerProxy.baseUrl}/${newPath}`
      }
    }

    return super.url(extracted)
  }

  protected getModelNameRemappings(): { searchValue: string; replaceValue: string }[] {
    return [{ searchValue: '^claude-(.*)$', replaceValue: 'anthropic.claude-$1-v1:0' }]
  }
}
