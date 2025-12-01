import type { ModelAPI } from '../api'
import type { ErrorResponse } from '../handler'
import type { ProviderProxy, SubFetch } from '../types'

export interface ProviderOptions {
  restOfPath: string
  providerProxy: ProviderProxy
  kv: KVNamespace
  subFetch: SubFetch
}

export type JsonData = object

export interface ExtractedInfo {
  requestBodyText: string
  requestBodyData: JsonData
}

export abstract class BaseProvider {
  readonly restOfPath: string
  readonly providerProxy: ProviderProxy
  readonly apiFlavor: string | undefined
  readonly kv: KVNamespace
  readonly subFetch: SubFetch

  constructor(options: ProviderOptions) {
    this.restOfPath = options.restOfPath
    this.providerProxy = options.providerProxy
    this.kv = options.kv
    this.subFetch = options.subFetch
    this.apiFlavor = this.initializeAPIFlavor()
  }

  protected abstract initializeAPIFlavor(): string | undefined
  abstract getRequestModel(extracted: ExtractedInfo): string | undefined
  abstract getModelAPI(extracted: ExtractedInfo): ModelAPI
  abstract authenticate(headers: Headers): Promise<ErrorResponse | null>

  providerId(): string {
    return this.providerProxy.providerId
  }

  /**
   * Get the provider ID to use for usage calculation.
   * This can be overridden by providers that need to use a different ID
   * based on response headers (e.g., HuggingFace uses different providers).
   */
  usageProviderId(): string {
    return this.providerProxy.providerId
  }

  requestBody(extracted: ExtractedInfo): ExtractedInfo | ErrorResponse {
    return extracted
  }

  url(_extracted: ExtractedInfo, _requestModel?: string): string {
    return `${this.providerProxy.baseUrl}/${this.restOfPath}`
  }

  filterResponseHeaders(_headers: Headers): void {}

  isWhitelistedEndpoint(): boolean {
    return false
  }

  /**
   * Override this method to provide custom fetch behavior (e.g., for testing).
   * If not implemented, the default fetch from gatewayOptions will be used.
   */
  fetch?(url: string, init: RequestInit): Promise<Response>

  /**
   * Replace model names according to provider-specific remappings.
   * This is used by providers that need to transform model names
   * (e.g., Google Vertex transforms claude-sonnet-4-0 -> claude-sonnet-4).
   */
  protected replaceModel(model: string): string {
    const remappings = this.getModelNameRemappings()
    for (const { searchValue, replaceValue } of remappings) {
      const regexp = new RegExp(searchValue)
      if (model.match(regexp)) {
        return model.replace(regexp, replaceValue)
      }
    }
    return model
  }

  /**
   * Get model name remappings for this provider.
   * Override this method to provide provider-specific model name transformations.
   */
  protected getModelNameRemappings(): Array<{ searchValue: string; replaceValue: string }> {
    return []
  }
}
