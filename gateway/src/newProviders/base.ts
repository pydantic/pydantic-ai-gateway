import type { ModelAPI } from '../api'
import type { ErrorResponse } from '../handler'
import type { ProviderProxy } from '../types'

export interface ProviderOptions {
  restOfPath: string
  providerProxy: ProviderProxy
}

export type JsonData = object

export interface ExtractedInfo {
  requestBodyText: string
  requestBodyData: JsonData
}

export abstract class BaseProvider {
  readonly restOfPath: string
  readonly providerProxy: ProviderProxy

  constructor(options: ProviderOptions) {
    this.restOfPath = options.restOfPath
    this.providerProxy = options.providerProxy
  }

  abstract getRequestModel(extracted: ExtractedInfo): string | undefined
  abstract getModelAPI(extracted: ExtractedInfo): ModelAPI
  abstract authenticate(headers: Headers): Promise<ErrorResponse | null>

  providerId(): string {
    return this.providerProxy.providerId
  }

  url(_extracted: ExtractedInfo): string {
    return `${this.providerProxy.baseUrl}/${this.restOfPath}`
  }
}
