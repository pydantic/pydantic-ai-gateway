import { type ApiKeyInfo, type KeyStatus, KeysDbD1, type ProviderProxy } from '@pydantic/ai-gateway'
import { config } from './config'

export class ConfigDB extends KeysDbD1 {
  async getApiKey(key: string): Promise<ApiKeyInfo | null> {
    const keyInfo = config.apiKeys[key]
    if (!keyInfo) {
      return null
    }
    const project = config.projects[keyInfo.project]!
    const user = keyInfo.user ? project.users[keyInfo.user] : undefined

    let providersWithKeys: (ProviderProxy & { key: string })[]
    if (keyInfo.providers === '__all__') {
      providersWithKeys = Object.entries(config.providers).map(([key, provider]) => ({ ...provider, key }))
    } else {
      providersWithKeys = keyInfo.providers.map((key) => ({ ...config.providers[key], key }))
    }

    // Transform routes to routingGroups
    const routingGroups: Record<string, { key: string }[]> = {}
    if (config.routes) {
      for (const [routeName, routeProviderKeys] of Object.entries(config.routes)) {
        routingGroups[routeName] = routeProviderKeys.map((providerKey) => ({ key: providerKey }))
      }
    }

    // if keyInfo.id is unset, hash the API key to give something unique without explicitly using the key directly
    const keyId = keyInfo.id

    let status: KeyStatus = Date.now() < (keyInfo.expires ?? Infinity) ? 'active' : 'expired'
    if (status === 'active') {
      const dbStatus = await this.getDbKeyStatus(keyId)
      if (dbStatus) {
        status = dbStatus
      }
    }

    return {
      id: keyId,
      user: keyInfo.user,
      project: keyInfo.project,
      // org doesn't really make sense for self-hosted deployments, so we just set it to 1
      org: 'org1',
      key,
      status,
      // key limits
      keySpendingLimitDaily: keyInfo.spendingLimitDaily,
      keySpendingLimitWeekly: keyInfo.spendingLimitWeekly,
      keySpendingLimitMonthly: keyInfo.spendingLimitMonthly,
      keySpendingLimitTotal: keyInfo.spendingLimitTotal,
      // project limits
      projectSpendingLimitDaily: project.spendingLimitDaily,
      projectSpendingLimitWeekly: project.spendingLimitWeekly,
      projectSpendingLimitMonthly: project.spendingLimitMonthly,
      // user limits
      userSpendingLimitDaily: user?.spendingLimitDaily,
      userSpendingLimitWeekly: user?.spendingLimitWeekly,
      userSpendingLimitMonthly: user?.spendingLimitMonthly,
      providers: providersWithKeys,
      routingGroups,
      otelSettings: user?.otel ?? project.otel,
    }
  }
}

export async function hash(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
