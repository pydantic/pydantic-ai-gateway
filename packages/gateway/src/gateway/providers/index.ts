import { ApiKeyInfo, ProviderProxy, ProxySchema } from '../../types'
import { GatewayEnv } from '../..'

import { AbstractProviderProxy } from './base'
import { OpenResponsesAIProvider } from './openai'

type providerSig = new (
  request: Request,
  env: GatewayEnv,
  apiKey: ApiKeyInfo,
  provider: ProviderProxy,
  restOfPath: string,
) => AbstractProviderProxy

export function getProvider(providerId: ProxySchema): providerSig {
  switch (providerId) {
    case 'openai':
      return OpenResponsesAIProvider
    case 'anthropic':
      throw new Error('Anthropic provider not yet implemented')
    default:
      const exhaustive: never = providerId
      throw new Error(`No provider found with providerId='${exhaustive}'`)
  }
}
