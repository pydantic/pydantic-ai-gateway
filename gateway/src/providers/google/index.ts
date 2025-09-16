import { DefaultProviderProxy, JsonData, isMapping } from '../default'
import { authToken } from './auth'
import { otelEvents, GoogleRequest, GenerateContentResponse } from './otel'

export class GoogleVertexProvider extends DefaultProviderProxy<JsonData, JsonData> {
  protected usageField = 'usageMetadata'

  url() {
    if (this.providerProxy.baseUrl) {
      const extra = this.restOfPath
        // I think this regex is for GLA aka the google developer API
        .replace(/^v1beta\/models\//, '')
        // this is for requests expecting google vertex
        .replace(/^v1beta1\/publishers\/google\/models\//, '')
      return `${this.providerProxy.baseUrl}/${extra}`
    } else {
      return { error: 'baseUrl is required for the Google Provider' }
    }
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData
    try {
      requestBodyData = JSON.parse(requestBodyText) as JsonData
    } catch (_error) {
      return { error: 'invalid request JSON' }
    }
    const m = /\/models\/(.+?):/.exec(this.restOfPath)
    if (m) {
      return { requestBodyText, requestBodyData, requestModel: m[1] }
    } else {
      return { error: 'unable to find model in path' }
    }
  }

  async requestHeaders(headers: Headers): Promise<void> {
    const token = await authToken(this.providerProxy.credentials, this.env.kv)
    headers.set('Authorization', `Bearer ${token}`)
  }

  otelEvents(requestBody: GoogleRequest, responseBody: GenerateContentResponse) {
    return otelEvents(requestBody, responseBody)
  }

  responseId(responseBody: JsonData): string | undefined {
    return isMapping(responseBody) && typeof responseBody.responseId === 'string' ? responseBody.responseId : undefined
  }
}
