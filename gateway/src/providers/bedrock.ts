import { ModelAPI } from '../api'
import { BedrockAPI } from '../api/bedrock'
import { DefaultProviderProxy } from './default'

export class AnthropicProvider extends DefaultProviderProxy {
  protected modelAPI(): ModelAPI | undefined {
    return new BedrockAPI()
  }
}
