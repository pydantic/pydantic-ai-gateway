import { describe, expect, it } from 'vitest'
import { getProviderProxies, weightedRandomSample } from '../src/gateway'
import type { ProviderProxy } from '../src/types'

describe('weightedRandomSample', () => {
  it('should return empty array for empty input', () => {
    const result = weightedRandomSample([])
    expect(result).toEqual([])
  })

  it('should return single item for single-item input', () => {
    const items = [{ id: 'a', weight: 5 }]
    const result = weightedRandomSample(items)
    expect(result).toEqual([{ id: 'a', weight: 5 }])
  })

  it('should return all items with positive weights', () => {
    const items = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 2 },
      { id: 'c', weight: 3 },
    ]
    const result = weightedRandomSample(items)
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('should place zero-weight items after positive-weight items', () => {
    const items = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 0 },
      { id: 'c', weight: 2 },
      { id: 'd', weight: 0 },
    ]
    const result = weightedRandomSample(items)
    expect(result).toHaveLength(4)

    // First two items should have positive weight
    expect(result[0]!.weight).toBeGreaterThan(0)
    expect(result[1]!.weight).toBeGreaterThan(0)

    // Last two items should have zero weight
    expect(result[2]!.weight).toBe(0)
    expect(result[3]!.weight).toBe(0)

    // All items should be present
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('should handle all zero-weight items', () => {
    const items = [
      { id: 'a', weight: 0 },
      { id: 'b', weight: 0 },
      { id: 'c', weight: 0 },
    ]
    const result = weightedRandomSample(items)
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('should respect weight distribution (statistical test)', () => {
    // Run the weighted sampling many times and verify the distribution
    const items = [
      { id: 'a', weight: 3 },
      { id: 'b', weight: 1 },
    ]

    const firstPositionCounts: Record<string, number> = { a: 0, b: 0 }
    const iterations = 10000

    for (let i = 0; i < iterations; i++) {
      const result = weightedRandomSample(items)
      const firstId = result[0]!.id
      firstPositionCounts[firstId] = (firstPositionCounts[firstId] ?? 0) + 1
    }

    // With weights 3:1, we expect roughly 75% 'a' and 25% 'b' in first position
    // Allow for some variance (±5%)
    const aRatio = (firstPositionCounts.a ?? 0) / iterations
    expect(aRatio).toBeGreaterThan(0.7)
    expect(aRatio).toBeLessThan(0.8)
  })

  it('should randomize zero-weight items', () => {
    // Run multiple times to ensure zero-weight items are randomized
    const items = [
      { id: 'a', weight: 0 },
      { id: 'b', weight: 0 },
    ]

    const results = new Set<string>()

    // Run enough times to likely see both orderings
    for (let i = 0; i < 20; i++) {
      const result = weightedRandomSample(items)
      results.add(result.map((r) => r.id).join(','))
    }

    // Should see both "a,b" and "b,a" orderings
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('getProviderProxies', () => {
  const mockProvider1: ProviderProxy & { key: string } = {
    key: 'provider1',
    providerId: 'openai',
    baseUrl: 'https://provider1.example.com',
    injectCost: true,
    credentials: 'test1',
  }

  const mockProvider2: ProviderProxy & { key: string } = {
    key: 'provider2',
    providerId: 'openai',
    baseUrl: 'https://provider2.example.com',
    injectCost: true,
    credentials: 'test2',
  }

  const mockProvider3: ProviderProxy & { key: string } = {
    key: 'provider3',
    providerId: 'anthropic',
    baseUrl: 'https://provider3.example.com',
    injectCost: true,
    credentials: 'test3',
  }

  it('should return single provider for direct route match', () => {
    const providerMapping = { provider1: mockProvider1 }
    const result = getProviderProxies('provider1', providerMapping, {})

    expect(Array.isArray(result)).toBe(true)
    expect((result as ProviderProxy[]).length).toBe(1)
    expect((result as ProviderProxy[])[0]).toEqual(mockProvider1)
  })

  it('should return 404 for unknown route', () => {
    const providerMapping = { provider1: mockProvider1 }
    const result = getProviderProxies('unknown', providerMapping, {})

    expect(result).toHaveProperty('status', 404)
    expect(result).toHaveProperty('message')
    expect((result as { message: string }).message).toContain('Route not found: unknown')
  })

  it('should handle routing group with default priority (backward compatible)', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2 }
    const routingGroups = { test: [{ key: 'provider1' as const }, { key: 'provider2' as const }] }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    expect((result as ProviderProxy[]).length).toBe(2)
  })

  it('should respect priority ordering', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2, provider3: mockProvider3 }
    const routingGroups = {
      test: [
        { key: 'provider1' as const, priority: 10, weight: 1 },
        { key: 'provider2' as const, priority: 5, weight: 1 },
        { key: 'provider3' as const, priority: 20, weight: 1 },
      ],
    }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    const providers = result as ProviderProxy[]
    expect(providers.length).toBe(3)

    // Should be ordered by priority: provider3 (20), provider1 (10), provider2 (5)
    expect(providers[0]!.baseUrl).toBe('https://provider3.example.com')
    expect(providers[1]!.baseUrl).toBe('https://provider1.example.com')
    expect(providers[2]!.baseUrl).toBe('https://provider2.example.com')
  })

  it('should handle negative weights by normalizing to zero', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2 }
    const routingGroups = {
      test: [
        { key: 'provider1' as const, weight: 1 },
        { key: 'provider2' as const, weight: -5 },
      ],
    }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    const providers = result as ProviderProxy[]
    expect(providers.length).toBe(2)

    // provider1 should always come first (positive weight)
    expect(providers[0]!.baseUrl).toBe('https://provider1.example.com')
    // provider2 should come second (normalized to zero weight)
    expect(providers[1]!.baseUrl).toBe('https://provider2.example.com')
  })

  it('should place zero-weight providers after positive-weight providers', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2, provider3: mockProvider3 }
    const routingGroups = {
      test: [
        // All items have the same priority so they're in the same priority group
        { key: 'provider1' as const, priority: 10, weight: 0 },
        { key: 'provider2' as const, priority: 10, weight: 5 },
        { key: 'provider3' as const, priority: 10, weight: 0 },
      ],
    }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    const providers = result as ProviderProxy[]
    expect(providers.length).toBe(3)

    // provider2 (weight 5) should be first
    expect(providers[0]!.baseUrl).toBe('https://provider2.example.com')

    // provider1 and provider3 (both weight 0) should be after provider2
    const lastTwoProviders = [providers[1]!.baseUrl, providers[2]!.baseUrl].sort()
    expect(lastTwoProviders).toEqual(['https://provider1.example.com', 'https://provider3.example.com'])
  })

  it('should combine priority and weight correctly', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2, provider3: mockProvider3 }
    const routingGroups = {
      test: [
        // High priority group with weight
        { key: 'provider1' as const, priority: 10, weight: 3 },
        { key: 'provider2' as const, priority: 10, weight: 1 },
        // Low priority provider
        { key: 'provider3' as const, priority: 5, weight: 10 },
      ],
    }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    const providers = result as ProviderProxy[]
    expect(providers.length).toBe(3)

    // First two should be from high priority group (10)
    const highPriorityUrls = [providers[0]!.baseUrl, providers[1]!.baseUrl].sort()
    expect(highPriorityUrls).toEqual(['https://provider1.example.com', 'https://provider2.example.com'])

    // Last should be from low priority group (5)
    expect(providers[2]!.baseUrl).toBe('https://provider3.example.com')
  })

  it('should return error when routing group has no valid providers', () => {
    const providerMapping = { provider1: mockProvider1 }
    const routingGroups = { test: [{ key: 'nonexistent' as const }] }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(result).toHaveProperty('status', 400)
    expect(result).toHaveProperty('message')
    expect((result as { message: string }).message).toContain('No providers included in routing group')
  })

  it('should use default priority based on index position', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2, provider3: mockProvider3 }
    const routingGroups = {
      test: [
        { key: 'provider1' as const }, // priority: 0 (default)
        { key: 'provider2' as const }, // priority: -1 (default)
        { key: 'provider3' as const }, // priority: -2 (default)
      ],
    }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    const providers = result as ProviderProxy[]
    expect(providers.length).toBe(3)

    // Should maintain original order due to default priorities
    expect(providers[0]!.baseUrl).toBe('https://provider1.example.com')
    expect(providers[1]!.baseUrl).toBe('https://provider2.example.com')
    expect(providers[2]!.baseUrl).toBe('https://provider3.example.com')
  })

  it('should handle mixed explicit and default priorities', () => {
    const providerMapping = { provider1: mockProvider1, provider2: mockProvider2, provider3: mockProvider3 }
    const routingGroups = {
      test: [
        { key: 'provider1' as const }, // priority: 0 (default)
        { key: 'provider2' as const, priority: 5 }, // priority: 5 (explicit)
        { key: 'provider3' as const }, // priority: -2 (default)
      ],
    }

    const result = getProviderProxies('test', providerMapping, routingGroups)

    expect(Array.isArray(result)).toBe(true)
    const providers = result as ProviderProxy[]
    expect(providers.length).toBe(3)

    // Order should be: provider2 (5), provider1 (0), provider3 (-2)
    expect(providers[0]!.baseUrl).toBe('https://provider2.example.com')
    expect(providers[1]!.baseUrl).toBe('https://provider1.example.com')
    expect(providers[2]!.baseUrl).toBe('https://provider3.example.com')
  })
})
