import {
  type Context,
  type HrTime,
  propagation,
  type SpanContext,
  type TextMapGetter,
  TraceFlags,
  trace,
} from '@opentelemetry/api'

import {
  type IExportTraceServiceResponse,
  type ISerializer,
  JsonTraceSerializer,
  ProtobufTraceSerializer,
} from '@opentelemetry/otlp-transformer'
import { resourceFromAttributes } from '@opentelemetry/resources'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base/build/src/export/ReadableSpan'
import * as logfire from '@pydantic/logfire-api'

import type { GatewayOptions } from '../index'
import type { OtelSettings, SubFetch } from '../types'

export type Attributes = Record<string, string | number | boolean | object | undefined>
export type Level = 'debug' | 'info' | 'notice' | 'warn' | 'error'

export class OtelTrace {
  private otelSettings: OtelSettings | undefined
  version: string
  private remoteParent?: SpanContext
  traceId: string
  private spans: ReadableSpan[] = []
  private subFetch: SubFetch

  constructor(request: Request, otelSettings: OtelSettings | undefined, options: GatewayOptions) {
    this.otelSettings = otelSettings
    this.version = options.githubSha
    this.subFetch = options.subFetch
    this.remoteParent = extractSpanContext(request.headers)
    if (this.remoteParent) {
      this.traceId = this.remoteParent.traceId
    } else {
      this.traceId = generateTraceId()
    }
  }

  startSpan(): OtelSpan {
    if (this.otelSettings) {
      return new ActiveOtelSpan(this, this.remoteParent)
    } else {
      return new NoopOtelSpan()
    }
  }

  async send(): Promise<void> {
    if (!this.otelSettings || !this.spans.length) {
      // otel not active or no spans to send, nothing to do
      return
    }

    const baseUrl = getBaseUrl(this.otelSettings)
    if (!baseUrl) {
      return
    }
    const headers = new Headers()
    if (this.otelSettings.writeToken) {
      headers.set('Authorization', this.otelSettings.writeToken)
    }

    const exportOtlpProtocol = this.otelSettings.exporterProtocol ?? 'http/protobuf'
    let serializer: ISerializer<ReadableSpan[], IExportTraceServiceResponse>
    if (exportOtlpProtocol === 'http/json') {
      headers.set('Content-Type', 'application/json')
      serializer = JsonTraceSerializer
    } else {
      headers.set('Content-Type', 'application/x-protobuf')
      serializer = ProtobufTraceSerializer
    }

    const body = serializer.serializeRequest(this.spans)
    if (body === undefined) {
      logfire.error('Failed to serialize spans', { span: this.spans })
      return
    }
    const response = await fetchRetry(this.subFetch, `${baseUrl}/v1/traces`, { method: 'POST', headers, body })
    if (!response.ok) {
      const text = await response.text()
      const headers = Object.fromEntries(response.headers.entries())
      logfire.warning(`Unexpected response from OTel: ${response.status}`, { status: response.status, text, headers })
    }
  }

  _addSpan(span: ReadableSpan): void {
    this.spans.push(span)
  }
}

abstract class OtelSpan {
  abstract startSpan(): OtelSpan
  abstract end(messageTemplate: string, attributes: Attributes, details?: { level?: Level }): void
}

class ActiveOtelSpan extends OtelSpan {
  private trace: OtelTrace
  private spanContext: SpanContext
  private parent?: SpanContext
  // start is unset for remote spans
  private start: HrTime
  private ended = false

  constructor(trace: OtelTrace, parent?: SpanContext) {
    super()
    this.trace = trace
    this.parent = parent
    this.start = getTime()
    this.spanContext = {
      traceId: trace.traceId,
      spanId: generateSpanId(),
      traceFlags: parent?.traceFlags ?? TraceFlags.NONE,
    }
  }

  startSpan() {
    return new ActiveOtelSpan(this.trace, this.spanContext)
  }

  end(messageTemplate: string, attributes: Attributes, details?: { level?: Level }) {
    if (this.ended) {
      throw new Error('Span already ended')
    }
    this.ended = true

    const now = getTime()
    const duration: HrTime = [now[0] - this.start[0], now[1] - this.start[1]]

    const span: ReadableSpan = {
      name: messageTemplate,
      kind: 0,
      spanContext: () => this.spanContext,
      parentSpanContext: this.parent,
      //TODO: should we we make start | undefined?
      startTime: this.start || now,
      endTime: now,
      status: { code: 1 },
      attributes: {
        'logfire.msg': renderMessage(messageTemplate, attributes),
        'logfire.json_schema': attributesJsonSchema(attributes),
        'logfire.level_num': mapLevel(details?.level ?? 'info'),
        ...attributes,
      },
      links: [],
      events: [],
      duration,
      ended: true,
      resource: resourceFromAttributes({ 'service.name': 'PAIG', 'service.version': this.trace.version }),
      instrumentationScope: { name: 'pydantic-ai-gateway' },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    }
    this.trace._addSpan(span)
  }
}

class NoopOtelSpan extends OtelSpan {
  private ended = false

  startSpan() {
    return new NoopOtelSpan()
  }
  end(_messageTemplate: string, _attributes: Attributes, _details?: { level?: Level }) {
    if (this.ended) {
      throw new Error('Span already ended')
    }
    this.ended = true
  }
}

function renderMessage(messageTemplate: string, attributes: Attributes): string {
  let message = messageTemplate
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      message = message.replace(`{${key}}`, value.toString())
    }
  }
  // console.log('Rendered message:', message)
  return message
}

function attributesJsonSchema(attributes: Attributes): string {
  const properties: Record<string, unknown> = {}
  for (const key of Object.keys(attributes)) {
    if (key === 'http.request.body' || key === 'http.response.body') {
      properties[key] = { type: 'object' }
    }
    const valueType = typeof attributes[key]
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
      properties[key] = { type: valueType }
    } else {
      properties[key] = {}
    }
  }
  return JSON.stringify({ type: 'object', properties })
}

function getTime(): HrTime {
  const now = Date.now()
  const seconds = Math.floor(now / 1000)
  const nanos = (now - seconds * 1000) * 1000000
  return [seconds, nanos]
}

function generateTraceId(): string {
  return generateHex(32)
}

function generateSpanId(): string {
  return generateHex(16)
}

/// generate a random traceID or spanID
export function generateHex(length: number): string {
  const size = Math.ceil(length / 2)
  const array = new Uint8Array(size)
  crypto.getRandomValues(array)
  return toHexString(array).substring(0, length)
}

const toHexString = (array: Uint8Array) => Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')

function mapLevel(levelName: Level): number {
  switch (levelName) {
    case 'debug':
      return 5
    case 'info':
      return 9
    case 'notice':
      return 10
    case 'warn':
      return 13
    case 'error':
      return 17
    default:
      throw new Error(`Unknown log level ${levelName}`)
  }
}

function extractSpanContext(headers: Headers): SpanContext | undefined {
  const contextData: Record<symbol, unknown> = {}

  const context: Context = {
    getValue(key: symbol): unknown {
      return contextData[key]
    },
    setValue(key: symbol, value: unknown): Context {
      contextData[key] = value
      return this
    },
    deleteValue(key: symbol): Context {
      delete contextData[key]
      return this
    },
  }

  propagation.extract(context, headers, headerTextMapGetter)

  return trace.getSpan(context)?.spanContext()
}

const headerTextMapGetter: TextMapGetter<Headers> = {
  get(headers, key) {
    const value = headers.get(key)
    return value ? [value] : []
  },
  keys(headers) {
    return [...headers.keys()]
  },
}

const SLEEPS = [0, 1000, 2000, 4000, 8000]
// Wrapper for fetch that retries on failure up to 5 times.
// Each request times out after 8 seconds
export async function fetchRetry(subFetch: SubFetch, url: string, input: RequestInit): Promise<Response> {
  let lastResponse: Response | null = null
  for (const sleepTime of SLEEPS) {
    if (sleepTime > 0) {
      logfire.warning(`Sleeping for ${sleepTime}ms before retrying...`)
      await sleep(sleepTime)
    }
    input.signal = AbortSignal.timeout(8000)
    try {
      const response = await subFetch(url, input)
      if (response.status >= 500) {
        logfire.warning(`Fetch failed with status ${response.status}`, { response })
        lastResponse = response
      } else {
        return response
      }
    } catch (error) {
      logfire.reportError(`Fetch failed`, error as Error)
    }
    input.signal = undefined
  }
  if (lastResponse) {
    return lastResponse
  } else {
    throw new Error(`Request failed after ${SLEEPS.length} retries`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getBaseUrl({ baseUrl, writeToken }: OtelSettings): string | undefined {
  if (baseUrl) {
    return baseUrl
  }
  const regionMatch = /pylf_v\d_(us|eu)/.exec(writeToken)
  if (regionMatch) {
    const region = regionMatch[1]
    return region === 'eu' ? 'https://api-eu.logfire.dev' : 'https://api.logfire.dev'
  }
  logfire.warning('unable to infer OTel base URL', { writeToken: writeToken.substring(0, 7) })
}
