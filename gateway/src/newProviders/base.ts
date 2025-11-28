import type { ModelAPI } from '../api'
import type { ErrorResponse } from '../handler'
import type { ProviderProxy } from '../types'

export interface ProviderOptions {
  restOfPath: string
  providerProxy: ProviderProxy
}

export abstract class BaseProvider {
  readonly restOfPath: string
  readonly providerProxy: ProviderProxy
  readonly modelAPI: ModelAPI

  constructor(options: ProviderOptions) {
    this.restOfPath = options.restOfPath
    this.providerProxy = options.providerProxy

    this.modelAPI = this.getModelAPI()
  }

  abstract getModelAPI(): ModelAPI
  abstract authenticate(headers: Headers): Promise<ErrorResponse | null>

  url(): string {
    return `${this.providerProxy.baseUrl}/${this.restOfPath}`
  }

  // Optional methods for providers that need request data for URL construction
  setRequestModel?(model: string): void
  setShouldStream?(shouldStream: boolean): void
}
