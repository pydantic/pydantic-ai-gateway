import type {
  Candidate,
  Content,
  ContentUnion,
  GenerateContentResponse,
  GenerationConfig,
  Part,
  Tool,
  ToolConfig,
} from '@google/genai'
import logfire from 'logfire'
import type {
  ChatMessage,
  InputMessages,
  JsonValue,
  MessagePart,
  OutputMessage,
  OutputMessages,
  TextPart,
} from '../otel/genai'
import { isMapping, type JsonData } from '../providers/default'
import { BaseAPI, type ExtractedRequest, type ExtractedResponse, type ExtractorConfig } from './base'

export { GenerateContentResponse } from '@google/genai'

export class GoogleAPI extends BaseAPI<GoogleRequest, GenerateContentResponse, GenerateContentResponse> {
  requestStopSequences = (_request: GoogleRequest): string[] | undefined => {
    return _request.generationConfig?.stopSequences ?? undefined
  }

  requestTemperature = (_request: GoogleRequest): number | undefined => {
    return _request.generationConfig?.temperature ?? undefined
  }

  requestTopP = (_request: GoogleRequest): number | undefined => {
    return _request.generationConfig?.topP ?? undefined
  }

  requestMaxTokens = (_request: GoogleRequest): number | undefined => {
    return _request.generationConfig?.maxOutputTokens ?? undefined
  }

  responseId = (responseBody: JsonData): string | undefined => {
    return isMapping(responseBody) && typeof responseBody.responseId === 'string' ? responseBody.responseId : undefined
  }

  responseFinishReasons = (responseBody: GenerateContentResponse): string[] | undefined => {
    const finishReasons: string[] = []

    for (const candidate of responseBody.candidates ?? []) {
      if (candidate.finishReason) {
        finishReasons.push(candidate.finishReason)
      }
    }

    return finishReasons.length > 0 ? finishReasons : undefined
  }

  inputMessages = (_request: GoogleRequest): InputMessages | undefined => {
    return _request.contents?.map(mapContent)
  }

  outputMessages = (_response: GenerateContentResponse): OutputMessages | undefined => {
    return _response.candidates?.map(mapResponseCandidate)
  }

  systemInstructions = (_request: GoogleRequest): TextPart[] | undefined => {
    return systemInstructions(_request.systemInstruction)
  }

  // SafeExtractor implementation

  requestExtractors: ExtractorConfig<GoogleRequest, ExtractedRequest> = {
    requestModel: (_request: GoogleRequest) => {
      this.extractedRequest.requestModel = this.requestModel
    },
  }

  chunkExtractors: ExtractorConfig<GenerateContentResponse, ExtractedResponse> = {
    usage: (chunk: GenerateContentResponse) => {
      if ('usageMetadata' in chunk && chunk.usageMetadata) {
        // Vertex may send a single {"usageMetadata": {"trafficType": "ON_DEMAND"}} instead of the full `usageMetadata` object on each chunk.
        // At the end of the stream, it will send the full `usageMetadata` object.
        const onlyTrafficTypeKey = Object.keys(chunk.usageMetadata).filter((key) => key !== 'trafficType')
        if (onlyTrafficTypeKey.length > 0) {
          this.extractedResponse.usage = this.extractUsage(chunk)
        }
      }
    },
    responseModel: (chunk: GenerateContentResponse) => {
      if (chunk.modelVersion) {
        this.extractedResponse.responseModel = chunk.modelVersion
      }
    },
  }
}

function mapContent(content: Content): ChatMessage {
  const role = content.role === 'model' ? 'assistant' : 'user'
  const parts: MessagePart[] = []

  for (const part of content.parts ?? []) {
    if (part.text) {
      parts.push({ type: 'text', content: part.text })
    } else if (part.functionCall) {
      parts.push({
        type: 'tool_call',
        id: part.functionCall.id,
        name: part.functionCall.name,
        arguments: part.functionCall.args as JsonValue | undefined,
      })
    } else if (part.functionResponse) {
      parts.push({
        type: 'tool_call_response',
        id: part.functionResponse.id,
        name: part.functionResponse.name,
        result: part.functionResponse.response as JsonValue | undefined,
      })
    } else if (part.fileData) {
      parts.push({
        type: 'file_data',
        file_uri: part.fileData.fileUri,
        mime_type: part.fileData.mimeType ?? undefined,
      })
    } else if (part.inlineData) {
      parts.push({ type: 'blob', mime_type: part.inlineData.mimeType, data: part.inlineData.data })
    } else if (part.thoughtSignature) {
      parts.push({ type: 'thinking', content: part.thoughtSignature })
    }

    // Any other part present should logfire.warning.
    const extraFields = Object.keys(part).filter(
      (key) =>
        key !== 'text' &&
        key !== 'functionCall' &&
        key !== 'functionResponse' &&
        key !== 'fileData' &&
        key !== 'inlineData' &&
        key !== 'thought' &&
        key !== 'thoughtSignature',
    )
    if (extraFields.length > 0) {
      logfire.warning('Extra fields found on part:', { extraFields, part })
    }
  }
  return { role, parts }
}

function mapResponseCandidate(candidate: Candidate): OutputMessage {
  return { ...mapContent(candidate.content ?? {}), finish_reason: candidate.finishReason }
}

// ContentUnion is `Content | (Part | string)[] | Part | string`
function systemInstructions(systemInstruction?: ContentUnion): TextPart[] {
  if (!systemInstruction) {
    return []
  }
  const chunks: TextPart[] = []
  if (Array.isArray(systemInstruction)) {
    // (Part | string)[]
    for (const part of systemInstruction) {
      if (typeof part === 'string') {
        chunks.push({ type: 'text', content: part })
      } else if (typeof part.text === 'string') {
        chunks.push({ type: 'text', content: part.text })
      } else {
        logfire.warning('unexpected part in systemInstruction', { part })
      }
    }
  } else if (typeof systemInstruction === 'string') {
    // string
    chunks.push({ type: 'text', content: systemInstruction })
  } else if ('parts' in systemInstruction || 'role' in systemInstruction) {
    // Content
    for (const part of mapContent(systemInstruction).parts) {
      if (part.type === 'text' && typeof part.content === 'string') {
        chunks.push({ type: 'text', content: part.content })
      } else {
        logfire.warning('unexpected part in systemInstruction', { part })
      }
    }
  } else {
    // Part (probably, technically could be Content with no parts or role)
    if (typeof (systemInstruction as Part).text === 'string') {
      chunks.push({ type: 'text', content: (systemInstruction as Part).text })
    } else {
      logfire.warning('unexpected part in systemInstruction', { part: systemInstruction as Part })
    }
  }
  return chunks
}

export interface GoogleRequest {
  contents?: Content[]
  systemInstruction?: ContentUnion
  tools?: Tool[]
  toolConfig: ToolConfig
  generationConfig?: GenerationConfig
}
