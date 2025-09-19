import { APIFlavor } from '../api'
import { DefaultProviderProxy } from './default'

// TODO(Marcelo): We use the beta API in PydanticAI, but does it matter here?

export class AnthropicProvider extends DefaultProviderProxy {
  protected apiFlavor(): keyof APIFlavor {
    return 'anthropic'
  }
}
