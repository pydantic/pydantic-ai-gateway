import { DefaultProviderProxy } from './default'

// TODO(Marcelo): The types (object, object) should change to the actual types.
export class OpenAIProvider extends DefaultProviderProxy<object, object> {
  flavor: 'chat' | 'responses' = 'chat'

  check() {
    if (this.restOfPath === 'responses') {
      this.flavor = 'responses'
    } else if (this.restOfPath !== 'chat/completions') {
      return { error: 'invalid url, not chat/completions or responses endpoint' }
    }
  }

  apiFlavour(): string | undefined {
    return this.flavor
  }
}
