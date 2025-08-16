import { ResponseError } from '../../utils'

import { DefaultProviderProxy } from './default'

export class OpenAIProvider extends DefaultProviderProxy {
  flavor: 'chat' | 'responses' = 'chat'

  check(): void {
    if (this.restOfPath === 'responses') {
      this.flavor = 'responses'
    } else if (this.restOfPath !== 'chat/completions') {
      throw new ResponseError(400, 'invalid url, not chat or responses endpoint')
    }
  }

  apiFlavour(): string | undefined {
    return this.flavor
  }
}
