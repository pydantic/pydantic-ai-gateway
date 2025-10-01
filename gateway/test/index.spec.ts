import { describe, expect } from 'vitest'
import { test } from './setup'

describe('index', () => {
  test('responds with index html', async ({ gateway }) => {
    const response = await gateway.fetch('https://example.com')
    expect(response.status).toBe(200)
    expect(await response.text()).toMatchInlineSnapshot(
      `
      "▗▄▄▖  ▗▄▖ ▗▄▄▄▖ ▗▄▄▖
      ▐▌ ▐▌▐▌ ▐▌  █  ▐▌
      ▐▛▀▘ ▐▛▀▜▌  █  ▐▌▝▜▌
      ▐▌   ▐▌ ▐▌▗▄█▄▖▝▚▄▞▘

      Pydantic AI Gateway

      git SHA: test
      GitHub: https://github.com/pydantic/pydantic-ai-gateway
      To connect, point your application at https://example.com/<provider-id>
      "
    `,
    )
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })
})
