import type { InputMessages, OutputMessages, TextPart } from './genai'

/** Semantic conventions for Generative AI
 * @see https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
 */
export interface GenAIAttributes {
  'gen_ai.request.max_tokens'?: number
  'gen_ai.request.seed'?: number
  'gen_ai.request.stop_sequences'?: string[]
  'gen_ai.request.temperature'?: number
  'gen_ai.request.top_k'?: number
  'gen_ai.request.top_p'?: number
  'gen_ai.response.id'?: string
  'gen_ai.response.finish_reasons'?: string[]
  'gen_ai.input.messages'?: InputMessages
  'gen_ai.output.messages'?: OutputMessages
  'gen_ai.system_instructions'?: TextPart[]

  // Those don't have extractors below because that API will be removed soon.
  'gen_ai.system'?: string
  'gen_ai.operation.name'?: string
  'gen_ai.request.model'?: string
  'gen_ai.response.model'?: string
  'gen_ai.usage.input_tokens'?: number
  'gen_ai.usage.cache_read_tokens'?: number
  'gen_ai.usage.cache_write_tokens'?: number
  'gen_ai.usage.output_tokens'?: number
  'gen_ai.usage.input_audio_tokens'?: number
  'gen_ai.usage.cache_audio_read_tokens'?: number
  'gen_ai.usage.output_audio_tokens'?: number
}
