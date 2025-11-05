interface OtlpAttribute {
  key: string
  value: OtlpValue
}

interface OtlpValue {
  stringValue?: string
  intValue?: number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values?: OtlpValue[] }
  kvlistValue?: { values?: { key: string; value: OtlpValue }[] }
}

/**
 * Deserializes OTLP trace data from a JSON string and transforms it into a cleaner JSON structure.
 * This extracts the key information from the OTLP format (resource spans, scope spans, etc.)
 * and returns a more readable representation suitable for test snapshots.
 */
export function deserializeRequest(data: string) {
  const otlpData = JSON.parse(data)

  // Transform OTLP format into cleaner JSON
  const spans = []

  for (const resourceSpan of otlpData.resourceSpans || []) {
    const resource = resourceSpan.resource?.attributes || []

    for (const scopeSpan of resourceSpan.scopeSpans || []) {
      const scope = scopeSpan.scope?.name

      for (const span of scopeSpan.spans || []) {
        // Convert attributes array to object
        const attributes: Record<string, unknown> = {}
        for (const attr of span.attributes || []) {
          attributes[attr.key] = extractOtlpValue(attr.value)
        }

        spans.push({
          name: span.name,
          parentSpanId: span.parentSpanId,
          kind: span.kind,
          attributes,
          status: span.status,
          events: span.events,
          links: span.links,
          resource: Object.fromEntries(
            resource.map((attr: OtlpAttribute) => [
              attr.key,
              attr.value.stringValue ??
                attr.value.intValue ??
                attr.value.doubleValue ??
                attr.value.boolValue ??
                attr.value,
            ]),
          ),
          scope,
        })
      }
    }
  }

  return spans
}

/**
 * Recursively extracts the actual value from an OTLP AnyValue structure.
 * Handles all OTLP value types including nested structures.
 */
function extractOtlpValue(value: OtlpValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue
  if (value.intValue !== undefined) return value.intValue
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.boolValue !== undefined) return value.boolValue

  if (value.arrayValue) {
    // For arrays, just extract the values directly without wrapping
    return value.arrayValue.values?.map(extractOtlpValue) || []
  }

  if (value.kvlistValue) {
    // For key-value lists, extract as an object
    const obj: Record<string, unknown> = {}
    for (const kv of value.kvlistValue.values || []) {
      obj[kv.key] = extractOtlpValue(kv.value)
    }
    return obj
  }

  // For empty objects or unknown types, return the raw value
  return value
}
