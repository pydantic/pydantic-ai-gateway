import * as logfire from '@pydantic/logfire-api'

import type {
  ChatCompletionCreateParamsBase,
  ChatCompletion,
  ChatCompletionMessageParam,
} from '@groq-chat/completions'
import { GenAiOtelEvent, GenaiChoiceEvent } from '../otelAttributes'

import { DefaultProviderProxy } from './default'

export class GroqProvider extends DefaultProviderProxy {
  otelEvents(requestBody: ChatCompletionCreateParamsBase, responseBody: ChatCompletion): GenAiOtelEvent[] {
    const events = requestBody.messages.map(mapRequestMessage)

    const choice = responseBody.choices[0]
    if (choice) {
      events.push(mapResponseMessage(choice))
    } else {
      logfire.warning('No choice found in Groq response', { responseBody })
    }
    return events
  }
}

function mapRequestMessage(message: ChatCompletionMessageParam): GenAiOtelEvent {
  const { role } = message
  if (role === 'system' || role === 'developer') {
    const { content } = message
    return {
      'event.name': 'gen_ai.system.message',
      role: 'system',
      content,
    }
  } else if (role === 'user') {
    const { content } = message
    return {
      'event.name': 'gen_ai.user.message',
      role: 'user',
      content,
    }
  } else if (role === 'tool') {
    const { content, tool_call_id } = message
    return {
      'event.name': 'gen_ai.tool.message',
      role: 'tool',
      id: tool_call_id,
      content,
    }
  } else if (role === 'assistant') {
    const { content, tool_calls } = message
    return {
      'event.name': 'gen_ai.assistant.message',
      role: 'assistant',
      content,
      tool_calls,
    }
  } else if (role === 'function') {
    // deprecated, shouldn't happen
    const { content } = message
    return {
      'event.name': 'gen_ai.assistant.message',
      role: 'assistant',
      content,
    }
  } else {
    const neverRole: never = role
    throw new Error(`Unexpected role: ${neverRole}`)
  }
}

function mapResponseMessage(choice: ChatCompletion.Choice): GenaiChoiceEvent {
  return {
    'event.name': 'gen_ai.choice',
    finish_reason: choice.finish_reason,
    index: 0,
    message: {
      role: 'assistant',
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    },
  }
}
