/** This module implements the OpenAI Responses API.
 * @see https://platform.openai.com/docs/api-reference/responses
 */

import { BaseAPI } from './base'

export class ResponsesAPI<RequestBody, ResponseBody> extends BaseAPI<RequestBody, ResponseBody> {
  apiFlavor = 'responses'
}
