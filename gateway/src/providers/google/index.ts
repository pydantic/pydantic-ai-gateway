import type { ModelAPI } from '../../api'
import { AnthropicAPI } from '../../api/anthropic'
import { GoogleAPI } from '../../api/google'
import type { ErrorResponse } from '../../handler'
import { BaseProvider, type ExtractedInfo, type ProviderOptions } from '../base'
import { authToken } from './auth'

const GOOGLE_PATH_REGEX =
  /^\/?(?:(v\d+(?:beta\d*)?)\/)?(?:projects\/[^/]+\/locations\/[^/]+\/)?(?:publishers\/([^/]+)\/)?models\/(.+):(.*)$/

function regionFromUrl(url: string): string {
  const match = url.match(/https:\/\/([a-z0-9-]+)-aiplatform\.googleapis\.com/)
  return match?.[1] ?? 'global'
}

function stripTrailingSlash(str: string): string {
  return str.endsWith('/') ? str.slice(0, -1) : str
}

function stripLeadingSlash(str: string): string {
  return str.startsWith('/') ? str.slice(1) : str
}

export class GoogleVertexProvider extends BaseProvider {
  private projectId: string | null = null
  private region: string

  constructor(options: ProviderOptions) {
    super(options)

    // Extract projectId from credentials
    try {
      const serviceAccount = JSON.parse(this.providerProxy.credentials)
      this.projectId = serviceAccount.project_id
    } catch {
      // For testing, use a default projectId
      this.projectId = 'pydantic-ai'
    }

    // Extract region from baseUrl (defaults to 'global')
    this.region = regionFromUrl(this.providerProxy.baseUrl)
  }

  private extractFromPath(): {
    version: string
    publisher: string
    model: string | undefined
    api: string | undefined
  } | null {
    const match = GOOGLE_PATH_REGEX.exec(this.restOfPath)
    if (!match) {
      return null
    }

    const version = match[1] || 'v1'
    const publisher = match[2] || 'google'
    const model = match[3]
    const api = match[4]

    return { version, publisher, model, api }
  }

  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // For v1/messages format, get model from body
    if (pathWithoutQuery === 'v1/messages') {
      if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
        return this.replaceModel(requestBodyData.model)
      }
    } else {
      // Try to extract model from URL path
      const pathInfo = this.extractFromPath()
      if (pathInfo?.model) {
        return this.replaceModel(pathInfo.model)
      }
    }

    return undefined
  }

  protected getModelNameRemappings(): Array<{ searchValue: string; replaceValue: string }> {
    return [
      { searchValue: '^claude-3-5-sonnet.*$', replaceValue: 'claude-3-5-sonnet' },
      { searchValue: '^claude-3-5-haiku.*$', replaceValue: 'claude-3-5-haiku' },
      { searchValue: '^claude-3-haiku.*$', replaceValue: 'claude-3-haiku' },
      { searchValue: '^claude-haiku-4-5.*$', replaceValue: 'claude-haiku-4-5' },
      { searchValue: '^claude-opus-4-1.*$', replaceValue: 'claude-opus-4-1' },
      { searchValue: '^claude-opus-4.*$', replaceValue: 'claude-opus-4-1' },
      { searchValue: '^claude-sonnet-4-0.*$', replaceValue: 'claude-sonnet-4' },
      { searchValue: '^claude-3-7-sonnet.*$', replaceValue: 'claude-3-7-sonnet' },
    ]
  }

  getModelAPI(_extracted: ExtractedInfo): ModelAPI {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Check if it's Anthropic format from path
    if (pathWithoutQuery === 'v1/messages') {
      return new AnthropicAPI('google-vertex')
    }

    // Check if publisher indicates Anthropic
    const pathInfo = this.extractFromPath()
    if (pathInfo?.publisher === 'anthropic') {
      return new AnthropicAPI('google-vertex')
    }

    return new GoogleAPI('google-vertex')
  }

  async authenticate(headers: Headers): Promise<ErrorResponse | null> {
    const tokenResult = await authToken(this.providerProxy.credentials, this.cache, this.subFetch)
    if ('error' in tokenResult) {
      return tokenResult
    }
    headers.set('Authorization', `Bearer ${tokenResult.token}`)
    return null
  }

  protected initializeAPIFlavor(): string | undefined {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Anthropic format through Google Vertex
    if (pathWithoutQuery === 'v1/messages') {
      return 'anthropic'
    }

    // Check if publisher indicates Anthropic
    const pathInfo = this.extractFromPath()
    if (pathInfo?.publisher === 'anthropic') {
      return 'anthropic'
    }

    // Default is Google API
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
        modified.anthropic_version = 'vertex-2023-10-16'
      }

      // Remove model field (Google Vertex doesn't expect it in the body)
      delete modified.model

      return { requestBodyText: JSON.stringify(modified), requestBodyData: modified }
    }

    return extracted
  }

  url(extracted: ExtractedInfo, requestModel?: string): string {
    if (!this.projectId) {
      return super.url(extracted, requestModel)
    }

    const path = this.replacePath(extracted, this.projectId, this.region, requestModel)
    return `${stripTrailingSlash(this.providerProxy.baseUrl)}/${stripLeadingSlash(path)}`
  }

  private replacePath(extracted: ExtractedInfo, projectId: string, region: string, requestModel?: string): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    const { requestBodyData } = extracted

    // Handle Anthropic client format: /v1/messages
    if (pathWithoutQuery === 'v1/messages') {
      if (requestModel) {
        const shouldStream = 'stream' in requestBodyData && requestBodyData.stream === true
        const action = shouldStream ? 'streamRawPredict' : 'rawPredict'
        return `/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${requestModel}:${action}`
      }
    }

    // Handle native Vertex format
    const pathInfo = this.extractFromPath()
    if (pathInfo) {
      const { version, publisher, model, api } = pathInfo
      if (version && publisher && model && api) {
        return `/${version}/projects/${projectId}/locations/${region}/publishers/${publisher}/models/${model}:${api}`
      }
    }

    return this.restOfPath
  }
}
