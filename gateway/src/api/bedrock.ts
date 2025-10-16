/** This module implements the AWS Bedrock Runtime API.
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_Operations_Amazon_Bedrock_Runtime.html
 */

import type { ConverseRequest, ConverseResponse } from '@aws-sdk/client-bedrock-runtime'
import { BaseAPI } from './base'

export class BedrockAPI extends BaseAPI<ConverseRequest, ConverseResponse> {
  defaultBaseUrl = 'https://bedrock-runtime.us-east-1.amazonaws.com'

  requestStopSequences = (requestBody: ConverseRequest): string[] | undefined => {
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

  // NOTE: It seems Bedrock does not return an ID in the response body.
  responseId = (_responseBody: ConverseResponse): string | undefined => {
    return undefined
  }
}

// TODO(Marcelo): Add input/output messages extraction.
