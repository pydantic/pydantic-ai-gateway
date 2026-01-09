import { findProvider, type Provider as UsageProvider } from '@pydantic/genai-prices'
import type { ModelAPI } from '../api'
import type { CacheAdapter } from '../cache'
import type { ErrorResponse } from '../handler'
import type { ProviderProxy, SubFetch } from '../types'

export interface ProviderOptions {
  restOfPath: string
  providerProxy: ProviderProxy
  cache: CacheAdapter
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
  readonly cache: CacheAdapter
  readonly subFetch: SubFetch

  constructor(options: ProviderOptions) {
    this.restOfPath = options.restOfPath
    this.providerProxy = options.providerProxy
    this.cache = options.cache
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

  usageProvider(): UsageProvider | undefined {
    return findProvider({ providerId: this.providerId() })
  }

  requestBody(extracted: ExtractedInfo): ExtractedInfo | ErrorResponse {
    return extracted
  }

  url(_extracted: ExtractedInfo, _requestModel?: string): string {
    return `${this.providerProxy.baseUrl}/${this.restOfPath}`
  }

  // Every provider probably has some response headers that we want to filter out.
  // TODO(Marcelo): We should make this an abstract method and require all providers to implement it.
  filterResponseHeaders(_headers: Headers): void {}

  isWhitelistedEndpoint(): boolean {
    return false
  }

  isBuiltin(): boolean {
    return this.providerProxy.isBuiltIn ?? false
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
