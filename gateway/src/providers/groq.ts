/** we're working with snake_case keys from the Groq API */

import { APIFlavor } from '../api'
import { DefaultProviderProxy } from './default'

export class GroqProvider extends DefaultProviderProxy {
  defaultBaseUrl = 'https://api.groq.com'

  protected apiFlavor(): keyof APIFlavor {
    return 'chat'
  }
}
