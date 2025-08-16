import { ResponseError } from '../../utils'

import { AbstractProviderProxy } from './base'

export class OpenResponsesAIProvider extends AbstractProviderProxy {
  flavor: 'chat' | 'responses' = 'chat'

  check(): void {
    if (this.restOfPath === 'responses') {
      this.flavor = 'responses'
    } else if (this.restOfPath !== 'chat/completions') {
      throw new ResponseError(400, 'invalid url, not chat or responses endpoint')
    }
  }

  providerId(): string {
    return 'openai'
  }

  apiFlavour(): string | undefined {
    return this.flavor
  }

  url() {
    return `${this.provider.baseURL}/${this.restOfPath}`
  }

  requestHeaders(headers: Headers) {
    headers.set('Authorization', `Bearer ${this.provider.credentials}`)
  }

  async prepRequest() {
    // todo better error on invalid JSON
    const body = await this.request.text()
    let model
    try {
      const data = JSON.parse(body)
      model = data.model
    } catch (error) {
      return { error: 'invalid request JSON' }
    }
    if (!model || typeof model !== 'string' || model.length === 0) {
      return { error: 'invalid request, "model" not found' }
    } else {
      return { body, model }
    }
  }
}
