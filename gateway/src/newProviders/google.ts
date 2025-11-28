import type { ModelAPI } from '../api'
import { AnthropicAPI } from '../api/anthropic'
import { GoogleAPI } from '../api/google'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ProviderOptions } from './base'

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
  private flavor: 'default' | 'anthropic' = 'default'
  private projectId: string | null = null
  private region: string | null = null
  private extractedPath: Partial<{ version: string; publisher: string; model: string; api: string }> = {}
  private requestModel: string | null = null
  private shouldStream: boolean = false

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

    // Parse path to extract version/publisher/model/api
    const pathWithoutQuery = this.restOfPath.split('?')[0]
    if (pathWithoutQuery && pathWithoutQuery !== 'v1/messages') {
      const extracted = this.extractFromPath()
      if (extracted) {
        const { version, publisher, model, api } = extracted
        if (publisher === 'anthropic') {
          this.flavor = 'anthropic'
        }
        this.extractedPath.version = version
        this.extractedPath.publisher = publisher
        this.extractedPath.model = model
        this.extractedPath.api = api
      }
    } else if (pathWithoutQuery === 'v1/messages') {
      this.flavor = 'anthropic'
    }
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

  getModelAPI(): ModelAPI {
    if (this.flavor === 'anthropic') {
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

  url(): string {
    if (!this.projectId || !this.region) {
      return super.url()
    }

    const path = this.replacePath(this.projectId, this.region)
    return `${stripTrailingSlash(this.providerProxy.baseUrl)}/${stripLeadingSlash(path)}`
  }

  private replacePath(projectId: string, region: string): string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Handle Anthropic client format: /v1/messages
    if (pathWithoutQuery === 'v1/messages' && this.requestModel) {
      const action = this.shouldStream ? 'streamRawPredict' : 'rawPredict'
      return `/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${this.requestModel}:${action}`
    }

    // Handle native Vertex format
    const { version, publisher, model, api } = this.extractedPath
    if (version && publisher && model && api) {
      return `/${version}/projects/${projectId}/locations/${region}/publishers/${publisher}/models/${model}:${api}`
    }

    return this.restOfPath
  }

  setRequestModel(model: string) {
    this.requestModel = model
  }

  setShouldStream(shouldStream: boolean) {
    this.shouldStream = shouldStream
  }
}
