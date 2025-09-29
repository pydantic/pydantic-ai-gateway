import type { GoogleRequest } from '../../api/google'
import { DefaultProviderProxy } from '../default'
import { authToken } from './auth'

export class GoogleVertexProvider extends DefaultProviderProxy {
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
    let requestBodyData: GoogleRequest
    try {
      requestBodyData = JSON.parse(requestBodyText)
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
}
