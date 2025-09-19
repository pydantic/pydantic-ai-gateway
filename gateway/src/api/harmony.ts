/** This module implements the OpenAI Harmony API.
 * @see https://github.com/openai/harmony
 */

import { BaseAPI } from './base'

export class HarmonyAPI<RequestBody, ResponseBody> extends BaseAPI<RequestBody, ResponseBody> {
  apiFlavor = 'harmony'
}
