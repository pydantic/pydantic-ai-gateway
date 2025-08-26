import { DefaultProviderProxy } from '../default'
import { authToken } from './auth'

export class GoogleVertexProvider extends DefaultProviderProxy {
  url() {
    if (this.providerProxy.baseUrl) {
      const extra = this.restOfPath.replace(/^v1beta\/models\//, '')
      return `${this.providerProxy.baseUrl}/${extra}`
    } else {
      return { error: 'baseUrl is required for the Google Provider' }
    }
  }

  async requestHeaders(headers: Headers): Promise<void> {
    const token = await authToken(this.providerProxy.credentials, this.env.kv)
    headers.set('Authorization', `Bearer ${token}`)
  }
}
