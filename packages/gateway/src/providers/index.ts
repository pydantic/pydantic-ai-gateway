import { ApiKeyInfo, ProviderProxy, ProviderID } from '../types'
import { GatewayEnv } from '..'

import { OpenAIProvider } from './openai'
import { GoogleVertexProvider } from './google'
import { GroqProvider } from './groq'
import { DefaultProviderProxy } from './default'

type providerSig = new (
  request: Request,
  env: GatewayEnv,
  apiKey: ApiKeyInfo,
  provider: ProviderProxy,
  restOfPath: string,
) => DefaultProviderProxy

export function getProvider(providerId: ProviderID): providerSig {
  switch (providerId) {
    case 'openai':
      return OpenAIProvider
    case 'groq':
      return GroqProvider
    case 'google':
      return GoogleVertexProvider
    default:
      return DefaultProviderProxy
  }
}
