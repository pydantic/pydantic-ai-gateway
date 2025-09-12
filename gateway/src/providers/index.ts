/*
Copyright (C) 2025 to present Pydantic Services Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { ApiKeyInfo, ProviderProxy, ProviderID } from '../types'
import { GatewayEnv } from '..'

import { OpenAIProvider } from './openai'
import { GoogleVertexProvider } from './google'
import { GroqProvider } from './groq'
import { DefaultProviderProxy } from './default'
import { AnthropicProvider } from './anthropic'
import { TestProvider } from './test'

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
    case 'google-vertex':
      return GoogleVertexProvider
    case 'anthropic':
      return AnthropicProvider
    case 'test':
      return TestProvider
    default:
      return DefaultProviderProxy
  }
}
