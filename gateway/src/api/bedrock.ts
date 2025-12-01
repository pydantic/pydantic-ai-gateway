/** This module implements the AWS Bedrock Runtime API.
 * @see https://docs.aws.amazon.com/bedrock/latest/APIReference/API_Operations_Amazon_Bedrock_Runtime.html
 */

import type { ConverseRequest, ConverseResponse, ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime'
import { BaseAPI, type ExtractedRequest, type ExtractedResponse, type ExtractorConfig } from './base'

export class ConverseAPI extends BaseAPI<ConverseRequest, ConverseResponse, ConverseStreamOutput> {
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

  // SafeExtractor implementation
  requestExtractors: ExtractorConfig<ConverseRequest, ExtractedRequest> = {
    requestModel: (requestBody: ConverseRequest) => {
      this.extractedRequest.requestModel = requestBody.modelId
    },
    maxTokens: (requestBody: ConverseRequest) => {
      this.extractedRequest.maxTokens = requestBody.inferenceConfig?.maxTokens
    },
    temperature: (requestBody: ConverseRequest) => {
      this.extractedRequest.temperature = requestBody.inferenceConfig?.temperature
    },
    topP: (requestBody: ConverseRequest) => {
      this.extractedRequest.topP = requestBody.inferenceConfig?.topP
    },
    stopSequences: (requestBody: ConverseRequest) => {
      this.extractedRequest.stopSequences = requestBody.inferenceConfig?.stopSequences
    },
  }

  responseExtractors: ExtractorConfig<ConverseResponse, ExtractedResponse> = {
    usage: (response: ConverseResponse) => {
      this.extractedResponse.usage = this.extractUsage(response)
    },
    responseModel: (_response: ConverseResponse) => {
      this.extractedResponse.responseModel = this.requestModel
    },
  }

  chunkExtractors: ExtractorConfig<ConverseStreamOutput, ExtractedResponse> = {
    usage: (chunk: ConverseStreamOutput) => {
      if ('usage' in chunk) {
        this.extractedResponse.usage = this.extractUsage(chunk)
      }
    },
    responseModel: (_chunk: ConverseStreamOutput) => {
      this.extractedResponse.responseModel = this.requestModel
    },
  }
}

// TODO(Marcelo): Add input/output messages extraction.
