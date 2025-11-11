import * as logfire from '@pydantic/logfire-api'
import { type GatewayOptions, noopLimiter } from '.'
import { apiKeyAuth, setApiKeyCache } from './auth'
import { currentScopeIntervals, type ExceededScope, endOfMonth, endOfWeek, type SpendScope } from './db'
import { OtelTrace } from './otel'
import { genAiOtelAttributes } from './otel/attributes'
import { getProvider } from './providers'
import { type ApiKeyInfo, guardProviderID, type ProviderID, providerIdsArray, ProviderProxy } from './types'
import { runAfter, textResponse } from './utils'

export async function gateway(
  request: Request,
  proxyPath: string,
  ctx: ExecutionContext,
  options: GatewayOptions,
): Promise<Response> {
  const providerIdMatch = /^\/([^/]+)\/(.*)$/.exec(proxyPath)
  if (!providerIdMatch) {
    return textResponse(404, 'Path not found')
  }
  const [, providerId, restOfPath] = providerIdMatch as unknown as [string, string, string]

  if (!guardProviderID(providerId)) {
    return textResponse(400, `Invalid provider ID '${providerId}', should be one of ${providerIdsArray.join(', ')}`)
  }

  const rateLimiter = options.rateLimiter ?? noopLimiter
  const apiKeyInfo = await apiKeyAuth(request, ctx, options, rateLimiter)
  try {
    return await gatewayWithLimiter(request, restOfPath, providerId, apiKeyInfo, ctx, options)
  } finally {
    runAfter(ctx, 'options.rateLimiter.requestFinish', rateLimiter.requestFinish())
  }
}

export async function gatewayWithLimiter(
  request: Request,
  restOfPath: string,
  providerId: ProviderID,
  apiKeyInfo: ApiKeyInfo,
  ctx: ExecutionContext,
  options: GatewayOptions,
): Promise<Response> {
  if (apiKeyInfo.status !== 'active') {
    return textResponse(403, `Unauthorized - Key ${apiKeyInfo.status}`)
  }

  const { routingGroups } = apiKeyInfo
  let providerProxies: (ProviderProxy & { key: string })[] = []

  const route = request.headers.get('pydantic-ai-gateway-route')
  if (route !== null) {
    const routingGroup = routingGroups[route]
    if (routingGroup) {
      providerProxies = routingGroup.map(({ key }) => apiKeyInfo.providers.find((p) => p.key === key))
    }
    // providerProxies = providerProxies.filter((p) => p.route === route)
  }

  // sort providers on priority, highest first
  providerProxies.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

  if (providerProxies.length === 0) {
    return textResponse(403, 'Forbidden - Provider not supported by this API Key')
  }

  const otel = new OtelTrace(request, apiKeyInfo.otelSettings, options)

  // The AI did this, but I actually find it nice.
  let result: Awaited<ReturnType<InstanceType<ReturnType<typeof getProvider>>['dispatch']>> | null = null

  for (const providerProxy of providerProxies) {
    const ProxyCls = getProvider(providerProxy.providerId)

    const otelSpan = otel.startSpan()
    const proxy = new ProxyCls({
      // Since the body is consumed by the proxy, we need to clone the request.
      request: request.clone(),
      gatewayOptions: options,
      apiKeyInfo,
      providerProxy,
      restOfPath,
      ctx,
      middlewares: options.proxyMiddlewares,
      otelSpan,
    })

    try {
      result = await proxy.dispatch()
    } catch (error) {
      logfire.reportError('Connection error', error as Error, {
        providerId: providerProxy.providerId,
        routingGroup: providerProxy.routingGroup,
      })
      continue
    }

    // Those responses are already closing the `otelSpan`.
    if (!('responseStream' in result) && !('response' in result) && !('unexpectedStatus' in result)) {
      const [spanName, attributes, level] = genAiOtelAttributes(result, proxy)
      otelSpan.end(spanName, attributes, { level })
    }

    // Check if we should retry with the next provider.
    if ('unexpectedStatus' in result && isRetryableError(result.unexpectedStatus)) {
      logfire.info('Provider failed with retryable error, trying next provider', {
        providerId: providerProxy.providerId,
        status: result.unexpectedStatus,
        routingGroup: providerProxy.routingGroup,
      })
      continue
    }

    // If it succeeds, or it's not a retryable error, we can break out of the loop.
    break
  }

  if (!result) {
    return textResponse(500, 'Internal Server Error')
  }

  let response: Response
  if ('response' in result) {
    response = result.response
  } else if ('responseStream' in result) {
    const { successStatus: status, responseHeaders: headers, responseStream, disableKey, onStreamComplete } = result
    runAfter(
      ctx,
      'recordSpend',
      (async () => {
        const complete = await onStreamComplete
        if ('cost' in complete && complete.cost) {
          await recordSpend(apiKeyInfo, complete.cost, options)
        } else if ('error' in complete) {
          const { key: _key, ...context } = apiKeyInfo
          if (disableKey) {
            logfire.reportError('api key blocked', complete.error, { context })
            await blockApiKey(apiKeyInfo, options, JSON.stringify(complete.error))
          } else {
            logfire.reportError('Unable to calculate cost', complete.error, { context })
          }
        }
        await otel.send()
      })(),
    )

    response = new Response(responseStream, { status, headers })
  } else if ('successStatus' in result) {
    const { successStatus: status, responseHeaders: headers, responseBody, cost } = result
    runAfter(ctx, 'recordSpend', recordSpend(apiKeyInfo, cost, options))
    response = new Response(responseBody, { status, headers })
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

  // TODO(Marcelo): This needs a bit of refactoring. We need the `otelSpan` to be closed before we send the spans.
  if (!('responseStream' in result)) {
    runAfter(ctx, 'otel.send', otel.send())
  }
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
  const { day, eow, eom } = currentScopeIntervals()

  const {
    id: keyId,
    project,
    user,
    keySpendingLimitDaily: keyDaily,
    keySpendingLimitWeekly: keyWeekly,
    keySpendingLimitMonthly: keyMonthly,
    keySpendingLimitTotal: keyTotal,
    projectSpendingLimitDaily: projectDaily,
    projectSpendingLimitWeekly: projectWeekly,
    projectSpendingLimitMonthly: projectMonthly,
    userSpendingLimitDaily: userDaily,
    userSpendingLimitWeekly: userWeekly,
    userSpendingLimitMonthly: userMonthly,
  } = apiKey

  const intervalSpends: SpendScope[] = [
    { entityId: keyId, entityType: 'key', scope: 'daily', scopeInterval: day, limit: keyDaily },
    { entityId: keyId, entityType: 'key', scope: 'weekly', scopeInterval: eow, limit: keyWeekly },
    { entityId: keyId, entityType: 'key', scope: 'monthly', scopeInterval: eom, limit: keyMonthly },
    { entityId: keyId, entityType: 'key', scope: 'total', limit: keyTotal },
    { entityId: project, entityType: 'project', scope: 'daily', scopeInterval: day, limit: projectDaily },
    { entityId: project, entityType: 'project', scope: 'weekly', scopeInterval: eow, limit: projectWeekly },
    { entityId: project, entityType: 'project', scope: 'monthly', scopeInterval: eom, limit: projectMonthly },
  ]

  if (user != null) {
    intervalSpends.push(
      { entityId: user, entityType: 'user', scope: 'daily', scopeInterval: day, limit: userDaily },
      { entityId: user, entityType: 'user', scope: 'weekly', scopeInterval: eow, limit: userWeekly },
      { entityId: user, entityType: 'user', scope: 'monthly', scopeInterval: eom, limit: userMonthly },
    )
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

function isRetryableError(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}
