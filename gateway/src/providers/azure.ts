import { OpenAIProvider } from './openai'

// TODO(Marcelo): The `AzureProvider` should be its own class, not a subclass of `OpenAIProvider`.
export class AzureProvider extends OpenAIProvider {}
// TODO(Marcelo): We should support Anthropic models as well.
