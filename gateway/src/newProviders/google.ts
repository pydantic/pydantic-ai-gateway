import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { GoogleAPI } from '../api/google'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo, type ProviderOptions } from './base'

const GOOGLE_PATH_REGEX =
  /^\/?(?:(v\d+(?:beta\d*)?)\/)?(?:projects\/[^/]+\/locations\/[^/]+\/)?(?:publishers\/([^/]+)\/)?models\/(.+):(.*)$/

function regionFromUrl(url: string): string | null {
  const match = url.match(/https:\/\/([a-z0-9-]+)-aiplatform\.googleapis\.com/)
  return match?.[1] ?? null
}

function stripTrailingSlash(str: string): string {
  return str.endsWith('/') ? str.slice(0, -1) : str
}

function stripLeadingSlash(str: string): string {
  return str.startsWith('/') ? str.slice(1) : str
}

export class GoogleVertexProvider extends BaseProvider {
  private projectId: string | null = null
  private region: string | null = null

  constructor(options: ProviderOptions) {
    super(options)

    // Extract projectId from credentials
    try {
      const serviceAccount = JSON.parse(this.providerProxy.credentials)
      this.projectId = serviceAccount.project_id
    } catch {
      // Will fail during authenticate if credentials are invalid
    }

    // Extract region from baseUrl
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
        return requestBodyData.model
      }
    } else {
      // Try to extract model from URL path
      const pathInfo = this.extractFromPath()
      if (pathInfo?.model) {
        return pathInfo.model
      }
    }

    return undefined
  }

  getModelAPI(extracted: ExtractedInfo): ModelAPI {
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

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    // Google Vertex auth is complex - requires JWT signing and token exchange
    // For now, assume credentials are passed as Bearer token directly
    // Real implementation needs authToken() from auth.ts which requires KV store
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }

  url(extracted: ExtractedInfo): string {
    if (!this.projectId || !this.region) {
      return super.url(extracted)
    }

    const path = this.replacePath(extracted, this.projectId, this.region)
    return `${stripTrailingSlash(this.providerProxy.baseUrl)}/${stripLeadingSlash(path)}`
  }

  private replacePath(extracted: ExtractedInfo, projectId: string, region: string): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    const { requestBodyData } = extracted

    // Handle Anthropic client format: /v1/messages
    if (pathWithoutQuery === 'v1/messages') {
      const requestModel = this.getRequestModel(extracted)
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
