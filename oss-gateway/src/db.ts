import { KeysDb, ApiKeyInfo } from '@pydantic/ai-gateway'
import { getConfig } from './config'
import { Config } from './types'

export class ConfigDB extends KeysDb {
  private config: Config

  constructor(env: Env) {
    super()
    this.config = getConfig(env)
  }

  async apiKeyAuth(key: string): Promise<ApiKeyInfo | null> {
    const keyInfo = this.config.apiKeys[key]
    if (!keyInfo) {
      return null
    }
    const team = this.config.teams[keyInfo.team]!
    let user = keyInfo.user ? team.users[keyInfo.user] : undefined
    return {
      id: key.substring(0, 5),
      user: keyInfo.user ?? null,
      team: keyInfo.team,
      org: this.config.org,
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
      providers: Object.fromEntries(keyInfo.providers.map((name) => [name, this.config.providers[name]!])),
    }
  }

  async disableKey(_id: string, _reason: string): Promise<void> {
    // do nothing
  }
}
