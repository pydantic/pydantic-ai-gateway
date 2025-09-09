import { DefaultProviderProxy } from './default'

export class OpenAIChatProvider extends DefaultProviderProxy {
  providerId() {
    return 'openai'
  }

  apiFlavour() {
    return 'chat'
  }
}

export class OpenAIResponsesProvider extends DefaultProviderProxy {
  providerId() {
    return 'openai'
  }

  apiFlavour() {
    return 'responses'
  }
}
