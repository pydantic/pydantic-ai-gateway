import * as logfire from '@pydantic/logfire-api'
import type {
  Content,
  GenerateContentResponse,
  ContentUnion,
  Tool,
  GenerationConfig,
  ToolConfig,
  Part,
  Candidate,
} from '@google/genai'
import { GenAiOtelEvent, GenaiChoiceEvent, ToolCall } from '../../otelAttributes'

export { GenerateContentResponse } from '@google/genai'

export interface GoogleRequest {
  content: Content[]
  systemInstruction?: ContentUnion
  tools?: Tool[]
  toolConfig: ToolConfig
  generationConfig?: GenerationConfig
}

// NOTE: this is a very incomplete implementation:
// * not all parts are properly supported
// * tools aren't supported properly
// * I don't entirely trust the types from @google/genai
export function otelEvents(requestBody: GoogleRequest, responseBody: GenerateContentResponse): GenAiOtelEvent[] {
  const events = systemEvents(requestBody.systemInstruction)
  events.push(...requestBody.content.map(mapContent))

  const candidate = responseBody.candidates?.[0]
  if (candidate) {
    events.push(mapResponseCandidate(candidate))
  } else {
    logfire.warning('No candidate found in Gemini response', { responseBody })
  }
  return events
}

// ContentUnion is `Content | (Part | string)[] | Part | string`
function systemEvents(systemInstruction?: ContentUnion): GenAiOtelEvent[] {
  if (!systemInstruction) {
    return []
  }
  const chunks: string[] = []
  if (Array.isArray(systemInstruction)) {
    // (Part | string)[]
    for (const part of systemInstruction) {
      if (typeof part === 'string') {
        chunks.push(part)
      } else {
        chunks.push(...convertSystemParts(part, systemInstruction))
      }
    }
  } else if (typeof systemInstruction === 'string') {
    // string
    chunks.push(systemInstruction)
  } else if ('parts' in systemInstruction || 'role' in systemInstruction) {
    // Content
    return [mapContent(systemInstruction)]
  } else {
    // Part (probably, technically could be Content with no parts or role)
    chunks.push(...convertSystemParts(systemInstruction as Part, systemInstruction))
  }
  return chunks.map((content) => ({
    'event.name': 'gen_ai.system.message',
    role: 'system',
    content,
  }))
}

interface ToolResponse {
  id: string
  name?: string
}

const extraPartFields = [
  'videoMetadata',
  'thought',
  'inlineData',
  'fileData',
  'thoughtSignature',
  'codeExecutionResult',
  'executableCode',
]

function mapContent({ role, parts }: Content): GenAiOtelEvent {
  const { content, toolCalls, toolResponse } = convertParts(parts)

  if (toolResponse) {
    // https://pydantic.slack.com/archives/C05AF4A4WRM/p1756295262502169
    return {
      'event.name': 'gen_ai.tool.message',
      role: 'tool',
      content,
      id: toolResponse.id,
      name: toolResponse.name,
    }
  }

  switch (role) {
    case 'system':
      return {
        'event.name': 'gen_ai.system.message',
        role: 'system',
        content,
      }
    case 'user':
      return {
        'event.name': 'gen_ai.user.message',
        role: 'user',
        content,
      }
    case 'model':
      return {
        'event.name': 'gen_ai.assistant.message',
        role: 'assistant',
        content,
        tool_calls: toolCalls,
      }
    default:
      logfire.warning('unknown role for part', { role, parts })
      return {
        'event.name': 'gen_ai.user.message',
        role: 'user',
        content: `<unknown role: ${role}> ${content}`,
      }
  }
}

interface PartsInfo {
  content: string
  toolCalls: ToolCall[]
  toolResponse?: ToolResponse
}

function convertParts(parts?: Part[]): PartsInfo {
  const contentText: string[] = []
  const toolCalls: ToolCall[] = []
  let toolResponse: ToolResponse | undefined

  for (const part of parts ?? []) {
    if (part.text) {
      contentText.push(part.text)
    }
    if (part.functionCall) {
      const { id, name, args } = part.functionCall
      const toolCall: ToolCall = {
        id: id ?? 'unknown',
        type: 'function',
        function: {
          name: name ?? 'unknown',
          arguments: JSON.stringify(args ?? {}),
        },
      }
      toolCalls.push(toolCall)
    }
    if (part.functionResponse) {
      const { id, name, response } = part.functionResponse
      contentText.push(JSON.stringify(response ?? {}))
      toolResponse = {
        id: id ?? 'unknown',
        name,
      }
    }
    const extraFields = extraPartFields.filter((field) => field in part)
    if (extraFields.length > 0) {
      logfire.warning('Extra fields found on part:', { extraFields, part })
    }
  }
  const content = contentText.join('')
  return {
    content,
    toolCalls,
    toolResponse,
  }
}

function convertSystemParts(part: Part, systemInstruction: ContentUnion): string[] {
  const { content, toolCalls, toolResponse } = convertParts([part])
  const contentText: string[] = []
  contentText.push(content)
  if (toolCalls.length) {
    logfire.warning('unexpected toolCalls in systemInstruction', { systemInstruction })
    contentText.push(JSON.stringify(toolCalls))
  }
  if (toolResponse) {
    logfire.warning('unexpected toolResponse in systemInstruction', { systemInstruction })
    contentText.push(JSON.stringify(toolResponse))
  }
  return contentText
}

function mapResponseCandidate({ finishReason, content: candidateContent }: Candidate): GenaiChoiceEvent {
  let content
  let toolCalls: ToolCall[] | undefined
  if (candidateContent) {
    const partsInfo = convertParts(candidateContent.parts)
    content = partsInfo.content
    toolCalls = partsInfo.toolCalls
  }
  return {
    'event.name': 'gen_ai.choice',
    finish_reason: finishReason ?? 'stop',
    index: 0,
    message: {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    },
  }
}
