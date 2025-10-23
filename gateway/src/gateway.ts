import * as logfire from '@pydantic/logfire-api'
import type { GatewayOptions } from '.'
import { apiKeyAuth, setApiKeyCache } from './auth'
import { type ExceededScope, endOfMonth, endOfWeek, type SpendScope, scopeIntervals } from './db'
import { OtelTrace } from './otel'
import { genAiOtelAttributes } from './otel/attributes'
import { getProvider } from './providers'
import { type ApiKeyInfo, guardProviderID, providerIdArray } from './types'
import { runAfter, textResponse } from './utils'

export async function gateway(
  request: Request,
  proxyPath: string,
  ctx: ExecutionContext,
  options: GatewayOptions,
): Promise<Response> {
  const providerMatch = /^\/([^/]+)\/(.*)$/.exec(proxyPath)
  if (!providerMatch) {
    return textResponse(404, 'Path not found')
  }
  const [, provider, restOfPath] = providerMatch as unknown as [string, string, string]

  if (!guardProviderID(provider)) {
    return textResponse(400, `Invalid provider '${provider}', should be one of ${providerIdArray.join(', ')}`)
  }

  const apiKeyInfo = await apiKeyAuth(request, ctx, options)

  if (apiKeyInfo.status !== 'active') {
    return textResponse(403, `Unauthorized - Key ${apiKeyInfo.status}`)
  }

  let providerProxies = apiKeyInfo.providers.filter((p) => p.providerId === provider)

  const profile = request.headers.get('pydantic-ai-gateway-profile')
  if (profile !== null) {
    providerProxies = providerProxies.filter((p) => p.profile === profile)
  }

  // sort providers on priority, highest first
  providerProxies.sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1))

  const providerProxy = providerProxies[0]
  if (!providerProxy) {
    return textResponse(403, 'Forbidden - Provider not supported by this API Key')
  }

  const otel = new OtelTrace(request, apiKeyInfo.otelSettings, options)

  const ProxyCls = getProvider(providerProxy.providerId)

  const proxy = new ProxyCls({
    request,
    gatewayOptions: options,
    apiKeyInfo,
    providerProxy,
    restOfPath,
    ctx,
    middlewares: options.proxyMiddlewares,
  })

  const dispatchSpan = otel.startSpan()
  const result = await proxy.dispatch()

  const [spanName, attributes, level] = genAiOtelAttributes(result, proxy)
  dispatchSpan.end(spanName, attributes, { level })

  let response: Response
  if ('responseStream' in result) {
    // Handle streaming responses
    const { successStatus, responseHeaders, responseStream, onStreamComplete } = result

    runAfter(
      ctx,
      'recordStreamSpend',
      (async () => {
        try {
          const { cost } = await onStreamComplete
          await recordSpend(apiKeyInfo, cost, options)
        } catch (error) {
          logfire.reportError('Error calculating streaming cost', error as Error)
          await blockApiKey(apiKeyInfo, options, 'Unable to calculate streaming cost')
        }
      })(),
    )

    response = new Response(responseStream, { status: successStatus, headers: responseHeaders })
  } else if ('successStatus' in result) {
    // Handle non-streaming responses
    const { successStatus, responseHeaders, responseBody, cost } = result
    runAfter(ctx, 'recordSpend', recordSpend(apiKeyInfo, cost, options))
    response = new Response(responseBody, { status: successStatus, headers: responseHeaders })
  } else if ('error' in result) {
    const { error, disableKey } = result
    if (disableKey) {
      // We need to pass `context` instead of `apiKeyInfo` because "apiKey" triggers the scrubbing.
      const { key: _key, ...context } = apiKeyInfo
      logfire.error('api key blocked', { context, error })
      runAfter(ctx, 'blockApiKey', blockApiKey(apiKeyInfo, options, 'Invalid request'))
      response = textResponse(400, `${error}, API key disabled`)
    } else {
      response = textResponse(400, error)
    }
  } else {
    const { unexpectedStatus, responseHeaders, responseBody } = result
    response = new Response(responseBody, { status: unexpectedStatus, headers: responseHeaders })
  }
  runAfter(ctx, 'otel.send', otel.send())
  return response
}

async function blockApiKey(apiKey: ApiKeyInfo, options: GatewayOptions, reason: string): Promise<void> {
  await disableApiKey(apiKey, options, reason, 'blocked')
}

export async function disableApiKey(
  apiKey: ApiKeyInfo,
  options: GatewayOptions,
  reason: string,
  newStatus: 'blocked' | 'limit-exceeded',
  expirationTtl?: number,
): Promise<void> {
  apiKey.status = newStatus
  await setApiKeyCache(apiKey, options, expirationTtl)
  await options.keysDb.disableKey(apiKey.id, reason, newStatus, expirationTtl)
}

async function recordSpend(apiKey: ApiKeyInfo, spend: number, options: GatewayOptions): Promise<void> {
  const { id, project, user } = apiKey

  const { day, endOfWeek, endOfMonth } = scopeIntervals()

  const intervalSpends: SpendScope[] = []
  if (isSet(apiKey.keySpendingLimitDaily)) {
    intervalSpends.push({
      entityId: id,
      entityType: 'key',
      scope: 'daily',
      scopeInterval: day,
      limit: apiKey.keySpendingLimitDaily,
    })
  }
  if (isSet(apiKey.keySpendingLimitWeekly)) {
    intervalSpends.push({
      entityId: id,
      entityType: 'key',
      scope: 'weekly',
      scopeInterval: endOfWeek,
      limit: apiKey.keySpendingLimitWeekly,
    })
  }
  if (isSet(apiKey.keySpendingLimitMonthly)) {
    intervalSpends.push({
      entityId: id,
      entityType: 'key',
      scope: 'monthly',
      scopeInterval: endOfMonth,
      limit: apiKey.keySpendingLimitMonthly,
    })
  }
  if (isSet(apiKey.keySpendingLimitTotal)) {
    intervalSpends.push({ entityId: id, entityType: 'key', scope: 'total', limit: apiKey.keySpendingLimitTotal })
  }

  if (user != null) {
    if (isSet(apiKey.userSpendingLimitDaily)) {
      intervalSpends.push({
        entityId: user,
        entityType: 'user',
        scope: 'daily',
        scopeInterval: day,
        limit: apiKey.userSpendingLimitDaily,
      })
    }
    if (isSet(apiKey.userSpendingLimitWeekly)) {
      intervalSpends.push({
        entityId: user,
        entityType: 'user',
        scope: 'weekly',
        scopeInterval: endOfWeek,
        limit: apiKey.userSpendingLimitWeekly,
      })
    }
    if (isSet(apiKey.userSpendingLimitMonthly)) {
      intervalSpends.push({
        entityId: user,
        entityType: 'user',
        scope: 'monthly',
        scopeInterval: endOfMonth,
        limit: apiKey.userSpendingLimitMonthly,
      })
    }
  }

  if (isSet(apiKey.projectSpendingLimitDaily)) {
    intervalSpends.push({
      entityId: project,
      entityType: 'project',
      scope: 'daily',
      scopeInterval: day,
      limit: apiKey.projectSpendingLimitDaily,
    })
  }
  if (isSet(apiKey.projectSpendingLimitWeekly)) {
    intervalSpends.push({
      entityId: project,
      entityType: 'project',
      scope: 'weekly',
      scopeInterval: endOfWeek,
      limit: apiKey.projectSpendingLimitWeekly,
    })
  }
  if (isSet(apiKey.projectSpendingLimitMonthly)) {
    intervalSpends.push({
      entityId: project,
      entityType: 'project',
      scope: 'monthly',
      scopeInterval: endOfMonth,
      limit: apiKey.projectSpendingLimitMonthly,
    })
  }
  const scopesExceeded = await options.limitDb.incrementSpend(intervalSpends, spend)

  if (scopesExceeded.length) {
    await disableApiKey(
      apiKey,
      options,
      'limits exceeded: ' + scopesExceeded.map(({ entityType, scope }) => `${entityType}-${scope}`).join(', '),
      'limit-exceeded',
      calculateExpirationTtl(scopesExceeded),
    )
  }
}

/**
 * Calculates the time-to-live (TTL) in seconds for API key expiration based on exceeded scopes.
 *
 * @param ex: Set of scope exceeded types that determine the expiration period
 * @returns TTL in seconds until the next reset period, undefined for permanently disabled keys
 *
 * - `key-total`: undefined
 * - Monthly scopes: Returns seconds until next month boundary
 * - Weekly scopes: Returns seconds until next week boundary
 * - Daily scopes: Returns seconds until next day boundary
 */
function calculateExpirationTtl(ex: ExceededScope[]): number | undefined {
  const scopes = new Set(ex.map(({ scope }) => scope))
  const now = new Date()
  let d: Date
  if (scopes.has('total')) {
    return
  } else if (scopes.has('monthly')) {
    d = endOfMonth(now)
  } else if (scopes.has('weekly')) {
    d = endOfWeek(now)
  } else if (scopes.has('daily')) {
    d = new Date(now)
  } else {
    throw new Error('Invalid spending limit scopes, unable to calculate expiration TTL')
  }
  d.setHours(23, 59, 59)
  return Math.floor((d.getTime() - now.getTime()) / 1000)
}

function isSet(value: number | null | undefined): value is number {
  return value !== null && value !== undefined
}
