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
        return this.replaceModel(requestBodyData.model)
      }
    } else {
      // Try to extract model from URL path: model/{model}/(converse|converse-stream|invoke|invoke-with-response-stream)
      // Need to decode the path because it may contain encoded characters like "%3A" (:)
      try {
        const decodedPath = decodeURIComponent(this.restOfPath)
        const m = decodedPath.match(/model\/(.+?)\/(converse|converse-stream|invoke|invoke-with-response-stream)/)
        if (m) {
          return m[1]
        }
      } catch {
        // If decoding fails, try without decoding
        const m = this.restOfPath.match(/model\/(.+?)\/(converse|converse-stream|invoke|invoke-with-response-stream)/)
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
      const m = decodedPath.match(/model\/(.+?)\/(converse|converse-stream|invoke|invoke-with-response-stream)/)
      if (m) {
        const api = m[2]
        const model = m[1]
        if (api?.startsWith('invoke') && model?.startsWith('anthropic.')) {
          return 'anthropic'
        }
      }
    } catch {
      // If decoding fails, try without decoding
      const m = this.restOfPath.match(/model\/(.+?)\/(converse|converse-stream|invoke|invoke-with-response-stream)/)
      if (m) {
        const api = m[2]
        const model = m[1]
        if (api?.startsWith('invoke') && model?.startsWith('anthropic.')) {
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

      let isStream: boolean | undefined
      // Remove stream field (Bedrock doesn't expect it)
      if ('stream' in modified) {
        isStream = modified.stream === true
        delete modified.stream
      }

      // Remove model field (Bedrock doesn't expect it)
      delete modified.model

      return { requestBodyText: JSON.stringify(modified), requestBodyData: modified, isStream }
    }

    return extracted
  }

  url(extracted: ExtractedInfo, requestModel?: string): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Handle Anthropic client format: v1/messages
    if (pathWithoutQuery === 'v1/messages') {
      if (requestModel) {
        const model = this.replaceModel(requestModel)
        const path = `model/${model}/${extracted.isStream ? 'invoke-with-response-stream' : 'invoke'}`
        return `${this.providerProxy.baseUrl}/${path}`
      }
    } else {
      // Handle model extraction in existing paths
      // Need to decode the path because it may contain encoded characters like "%3A" (:)
      let path: string | undefined
      let m: RegExpMatchArray | null = null
      const apiPattern = /model\/(.+?)\/(converse|converse-stream|invoke|invoke-with-response-stream)/
      try {
        path = decodeURIComponent(this.restOfPath)
        m = path.match(apiPattern)
      } catch {
        path = this.restOfPath
        m = this.restOfPath.match(apiPattern)
      }
      if (m) {
        const model = m[1] && this.replaceModel(m[1])
        const api = m[2]
        const newPath = path.replace(apiPattern, `model/${model}/${api}`)
        return `${this.providerProxy.baseUrl}/${newPath}`
      }
    }

    return super.url(extracted)
  }

  protected getModelNameRemappings(): { searchValue: string; replaceValue: string }[] {
    return [
      { searchValue: '^claude-sonnet-4[-.]5$', replaceValue: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
      { searchValue: '^claude-opus-4[-.]5$', replaceValue: 'us.anthropic.claude-opus-4-5-20251101-v1:0' },
      { searchValue: '^claude-opus-4[-.]1$', replaceValue: 'us.anthropic.claude-opus-4-1-20250805-v1:0' },
      { searchValue: '^claude-haiku-4[-.]5$', replaceValue: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
      { searchValue: '^claude-sonnet-3[-.]7$', replaceValue: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0' },
      { searchValue: '^claude-haiku-3[-.]5$', replaceValue: 'us.anthropic.claude-3-5-haiku-20241022-v1:0' },
      { searchValue: '^claude-sonnet-4$', replaceValue: 'us.anthropic.claude-sonnet-4-20250514-v1:0' },
      { searchValue: '^claude-opus-4$', replaceValue: 'us.anthropic.claude-opus-4-20250514-v1:0' },
      { searchValue: '^claude-haiku-3$', replaceValue: 'us.anthropic.claude-3-haiku-20240307-v1:0' },
      { searchValue: '^claude-4[-.]5-sonnet$', replaceValue: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' },
      { searchValue: '^claude-4[-.]5-opus$', replaceValue: 'us.anthropic.claude-opus-4-5-20251101-v1:0' },
      { searchValue: '^claude-4[-.]1-opus$', replaceValue: 'us.anthropic.claude-opus-4-1-20250805-v1:0' },
      { searchValue: '^claude-4[-.]5-haiku$', replaceValue: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
      { searchValue: '^claude-3[-.]7-sonnet$', replaceValue: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0' },
      { searchValue: '^claude-3[-.]5-haiku$', replaceValue: 'us.anthropic.claude-3-5-haiku-20241022-v1:0' },
      { searchValue: '^claude-3-haiku$', replaceValue: 'us.anthropic.claude-3-haiku-20240307-v1:0' },
      { searchValue: '^claude-4-sonnet$', replaceValue: 'us.anthropic.claude-sonnet-4-20250514-v1:0' },
      { searchValue: '^claude-4-opus$', replaceValue: 'us.anthropic.claude-opus-4-20250514-v1:0' },
      { searchValue: '^claude-(.*)$', replaceValue: 'us.anthropic.claude-$1-v1:0' },
    ]
  }
}
