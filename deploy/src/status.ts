import { SpendStatus, LimitDb } from '@pydantic/ai-gateway'
import { config } from './config'

interface EntityStatus {
  id: number
  name: string
  spendingLimitDaily?: number
  spendingLimitWeekly?: number
  spendingLimitMonthly?: number
  spend: SpendStatus[]
}

interface TeamStatus extends EntityStatus {
  users: EntityStatus[]
}

interface KeyStatus extends EntityStatus {
  expires?: number
  spendingLimitTotal?: number
}

interface Status {
  teams: TeamStatus[]
  keys: KeyStatus[]
}

export async function status(limitdb: LimitDb): Promise<Response> {
  const teamStatus = await limitdb.spendStatus('team')
  const userStatus = await limitdb.spendStatus('user')
  const keyStatus = await limitdb.spendStatus('key')

  const data: Status = {
    teams: Object.entries(config.teams).map(([id, team]) => {
      const teamId = Number(id)
      return {
        id: teamId,
        name: team.name,
        spendingLimitDaily: team.spendingLimitDaily,
        spendingLimitWeekly: team.spendingLimitWeekly,
        spendingLimitMonthly: team.spendingLimitMonthly,
        spend: teamStatus.filter((t) => t.entityId === teamId),
        users: Object.entries(team.users).map(([id, user]) => {
          const userId = Number(id)
          return {
            id: userId,
            name: user.name,
            spend: userStatus.filter((t) => t.entityId === userId),
            spendingLimitDaily: user.spendingLimitDaily,
            spendingLimitWeekly: user.spendingLimitWeekly,
            spendingLimitMonthly: user.spendingLimitMonthly,
          }
        }),
      }
    }),
    keys: Object.entries(config.apiKeys).map(([apiKey, keyInfo]) => ({
      id: keyInfo.id,
      name: `${apiKey.substring(0, 5)}...`,
      spend: keyStatus.filter((t) => t.entityId === keyInfo.id),
      expires: keyInfo.expires,
      spendingLimitDaily: keyInfo.spendingLimitDaily,
      spendingLimitWeekly: keyInfo.spendingLimitWeekly,
      spendingLimitMonthly: keyInfo.spendingLimitMonthly,
      spendingLimitTotal: keyInfo.spendingLimitTotal,
    })),
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
