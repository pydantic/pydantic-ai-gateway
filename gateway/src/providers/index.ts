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

import type { ProviderID } from '../types'

import { AnthropicProvider } from './anthropic'
import { AzureProvider } from './azure'
import { BedrockProvider } from './bedrock'
import { DefaultProviderProxy, type ProviderOptions } from './default'
import { GoogleVertexProvider } from './google'
import { GroqProvider } from './groq'
import { OpenAIProvider } from './openai'
import { TestProvider } from './test'

type ProviderSig = new (options: ProviderOptions) => DefaultProviderProxy

export function getProvider(providerId: ProviderID): ProviderSig {
  switch (providerId) {
    case 'openai':
      return OpenAIProvider
    case 'azure':
      return AzureProvider
    case 'groq':
      return GroqProvider
    case 'google-vertex':
      return GoogleVertexProvider
    case 'anthropic':
      return AnthropicProvider
    case 'bedrock':
      return BedrockProvider
    case 'test':
      return TestProvider
    default:
      return DefaultProviderProxy
  }
}
