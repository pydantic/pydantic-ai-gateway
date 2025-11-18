import type { ModelAPI } from '../../api'
import { AnthropicAPI } from '../../api/anthropic'
import { GoogleAPI, type GoogleRequest } from '../../api/google'
import { DefaultProviderProxy, type ProxyInvalidRequest } from '../default'
import { authToken, getServiceAccount } from './auth'

export class GoogleVertexProvider extends DefaultProviderProxy {
  protected usageField = 'usageMetadata'
  flavor: 'default' | 'anthropic' = 'default'

  // NOTE: This should be moved to the `DefaultProviderProxy` class.
  protected shouldStream: boolean = false

  url() {
    if (this.providerProxy.baseUrl) {
      const serviceAccountResult = getServiceAccount(this.providerProxy.credentials)
      if ('error' in serviceAccountResult) {
        return serviceAccountResult
      }
      const projectId = serviceAccountResult.project_id
      const region = regionFromUrl(this.providerProxy.baseUrl)
      if (!region) {
        return { error: 'Unable to extract region from URL' }
      }
      const path = this.replacePath(projectId, region)
      if (!path) {
        return { error: 'Unable to parse path' }
      }
      return `${stripTrailingSlash(this.providerProxy.baseUrl)}/${stripLeadingSlash(path)}`
    } else {
      return { error: 'baseUrl is required for the Google Provider' }
    }
  }

  apiFlavor(): string | undefined {
    return this.flavor
  }

  protected modelAPI(): ModelAPI {
    if (this.flavor === 'anthropic') {
      return new AnthropicAPI('google-vertex')
    } else {
      return new GoogleAPI('google-vertex')
    }
  }

  /**
   * Replace the projectId and region in the path.
   *
   * The path can be in multiple formats:
   * - /{version}/projects/{projectId}/locations/{region}/publishers/{publisher}/models/{model}:{api}
   * - /{version}/projects/{projectId}/locations/{region}/models/{model}:{api}
   * - /{version}/publishers/{publisher}/models/{model}:{api}
   * - /{version}/models/{model}:{api}
   *
   * The known values of `version` are `v1beta` and `v1`.
   *
   * This function will replace the projectId and region in the path.
   * @param path - The path to replace the projectId and region in.
   * @param projectId - The projectId to replace in the path.
   * @param region - The region to replace in the path.
   */
  private replacePath(projectId: string, region: string): null | string {
    const pathWithoutQuery = this.restOfPath.split('?')[0]

    // Handle Anthropic client format: /v1/messages
    if (pathWithoutQuery === 'v1/messages' && this.requestModel) {
      // Always use streamRawPredict for Anthropic on Vertex (it handles both streaming and non-streaming)
      const action = this.shouldStream ? 'streamRawPredict' : 'rawPredict'
      return `/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${this.requestModel}:${action}`
    }

    // Regex with capture groups: version (optional), publisher (optional), model
    // Path may or may not start with / and may or may not have version
    const regex =
      /^\/?(?:(v\d+(?:beta\d*)?)\/)?(?:projects\/[^/]+\/locations\/[^/]+\/)?(?:publishers\/([^/]+)\/)?models\/(.+)$/
    const match = regex.exec(this.restOfPath)

    if (!match) {
      return null
    }

    const version = match[1] || 'v1'
    const publisher = match[2] || 'google'
    const modelAndApi = match[3]

    if (publisher === 'anthropic') {
      this.flavor = 'anthropic'
    }

    const path = `/${version}/projects/${projectId}/locations/${region}/publishers/${publisher}/models/${modelAndApi}`
    return path
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData: GoogleRequest & { anthropic_version?: string }
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
      const model = requestBodyData.model as string
      this.requestModel = model

      if (!('anthropic_version' in requestBodyData)) {
        requestBodyData.anthropic_version = 'vertex-2023-10-16'
      }

      // Remove the model from the request body since Google Vertex doesn't expect it
      delete requestBodyData.model

      // Update requestBodyText without the model field
      const updatedRequestBodyText = JSON.stringify(requestBodyData)

      return { requestBodyText: updatedRequestBodyText, requestBodyData, requestModel: model }
    }

    const m = /\/models\/(.+?):/.exec(this.restOfPath)
    if (m) {
      return { requestBodyText, requestBodyData, requestModel: m[1] }
    } else {
      return { error: 'unable to find model in path' }
    }
  }

  protected isStreaming(responseHeaders: Headers, requestBodyData: object): boolean {
    if (this.flavor === 'anthropic') {
      this.shouldStream = !!('stream' in requestBodyData && requestBodyData.stream === true)
    } else {
      this.shouldStream = super.isStreaming(responseHeaders, requestBodyData)
    }
    return this.shouldStream
  }

  async requestHeaders(headers: Headers): Promise<ProxyInvalidRequest | null> {
    const tokenResult = await authToken(this.providerProxy.credentials, this.options.kv, this.options.subFetch)
    if ('error' in tokenResult) {
      return tokenResult
    } else {
      headers.set('Authorization', `Bearer ${tokenResult.token}`)
      return null
    }
  }
}

/**
 * Extracts the region from the URL.
 * In case the URL is https://aiplatform.googleapis.com, the region is "global".
 * In case the URL is https://europe-west4-aiplatform.googleapis.com, the region is "europe-west4".
 * @param url - The URL to extract the region from e.g. https://europe-west4-aiplatform.googleapis.com or https://aiplatform.googleapis.com.
 */
function regionFromUrl(url: string): null | string {
  const match = url.match(/^https:\/\/([^-]+)-aiplatform\.googleapis\.com$/)
  return match?.[1] ?? 'global'
}

const stripTrailingSlash = (url: string): string => (url.endsWith('/') ? url.slice(0, -1) : url)
const stripLeadingSlash = (url: string): string => (url.startsWith('/') ? url.slice(1) : url)
