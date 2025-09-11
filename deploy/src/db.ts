import { KeysDb, ApiKeyInfo, ProviderProxy } from '@pydantic/ai-gateway'
import { config } from './config'

export class ConfigDB extends KeysDb {
  async apiKeyAuth(key: string): Promise<ApiKeyInfo | null> {
    const keyInfo = config.apiKeys[key]
    if (!keyInfo) {
      return null
    }
    const team = config.teams[keyInfo.team]!
    let user = keyInfo.user ? team.users[keyInfo.user] : undefined

    let providers: ProviderProxy[]
    if (keyInfo.providers == '__all__') {
      providers = Object.values(config.providers)
    } else {
      providers = keyInfo.providers.map((name) => config.providers[name])
    }

    return {
      // if keyInfo.id is unset, hash the API key to give something unique without explicitly using the key directly
      id: keyInfo.id ?? (await hash(key)),
      user: keyInfo.user ?? null,
      team: keyInfo.team,
      org: config.org,
      key,
      active: keyInfo.expires ? Date.now() < keyInfo.expires : true,
      // key limits
      keySpendingLimitDaily: keyInfo.spendingLimitDaily ?? null,
      keySpendingLimitWeekly: keyInfo.spendingLimitWeekly ?? null,
      keySpendingLimitMonthly: keyInfo.spendingLimitMonthly ?? null,
      keySpendingLimitTotal: keyInfo.spendingLimitTotal ?? null,
      // team limits
      teamSpendingLimitDaily: team.spendingLimitDaily ?? null,
      teamSpendingLimitWeekly: team.spendingLimitWeekly ?? null,
      teamSpendingLimitMonthly: team.spendingLimitMonthly ?? null,
      // user limits
      userSpendingLimitDaily: user?.spendingLimitDaily ?? null,
      userSpendingLimitWeekly: user?.spendingLimitWeekly ?? null,
      userSpendingLimitMonthly: user?.spendingLimitMonthly ?? null,
      providers,
      otelSettings: user?.otel ?? team.otel ?? null,
    }
  }

  async disableKey(_id: string, _reason: string): Promise<void> {
    // do nothing
  }
}

export async function hash(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
