/** This module implements the OpenAI Responses API.
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import { BaseAPI } from './base'

export class ResponsesAPI extends BaseAPI<object, object> {
  apiFlavor = 'responses'
}
