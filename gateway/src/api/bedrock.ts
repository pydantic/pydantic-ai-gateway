/** This module implements the AWS Bedrock Runtime API.
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_Operations_Amazon_Bedrock_Runtime.html
 */

import type { ConverseRequest, ConverseResponse } from '@aws-sdk/client-bedrock-runtime'
import { BaseAPI } from './base'

export class BedrockAPI extends BaseAPI<ConverseRequest, ConverseResponse> {
  defaultBaseUrl = 'https://bedrock-runtime.us-east-1.amazonaws.com'

  requestStopSequences = (requestBody: ConverseRequest): string[] | undefined => {
    console.log('hi there')
    console.log('requestBody', requestBody)
    return requestBody.inferenceConfig?.stopSequences
  }

  requestTemperature = (requestBody: ConverseRequest): number | undefined => {
    return requestBody.inferenceConfig?.temperature
  }

  requestTopP = (requestBody: ConverseRequest): number | undefined => {
    return requestBody.inferenceConfig?.topP
  }

  requestMaxTokens = (requestBody: ConverseRequest): number | undefined => {
    return requestBody.inferenceConfig?.maxTokens
  }

  responseId = (responseBody: ConverseResponse): string | undefined => {
    console.log('responseBody', responseBody)
    return undefined
  }
}
