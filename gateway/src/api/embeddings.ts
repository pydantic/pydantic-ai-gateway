import type { EmbeddingCreateParams, Embeddings } from 'openai/resources/embeddings'
import { BaseAPI } from './base'

export class EmbeddingsAPI extends BaseAPI<EmbeddingCreateParams, Embeddings> {
  apiFlavor = 'embeddings'
}
