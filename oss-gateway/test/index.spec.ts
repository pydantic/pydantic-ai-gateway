import { SELF } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

describe('pydantic ai gateway', () => {
  it('responds with index html', async () => {
    const response = await SELF.fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `
      "<h1>Pydantic AI Gateway</h1>
      <p>release: unknown</p>
      "
    `,
    )
  })
})
