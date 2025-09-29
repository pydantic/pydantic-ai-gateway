import type { ModelAPI } from '../api'
import { BedrockAPI } from '../api/bedrock'
import { DefaultProviderProxy } from './default'

export class BedrockProvider extends DefaultProviderProxy {
  protected modelAPI(): ModelAPI | undefined {
    return new BedrockAPI()
  }
}
