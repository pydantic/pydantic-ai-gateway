import { type Provider, updatePrices, waitForUpdate } from '@pydantic/genai-prices'

// data will be refetched every 30 minutes
const PRICE_TTL = 1000 * 60 * 30
let genaiDataTimestamp: number | null = null
let isFetching = false

export function refreshGenaiPrices() {
  updatePrices(({ setProviderData, remoteDataUrl }) => {
    if (genaiDataTimestamp !== null) {
      console.debug('genai prices in-memory cache found')

      if (Date.now() - genaiDataTimestamp < PRICE_TTL) {
        // this will be the most frequent, cheap path
        console.debug('genai prices in-memory data is fresh')
        return
      } else {
        console.debug('genai prices in-memory cache is stale, attempting to fetch remote data')
      }
    }

    if (isFetching) {
      console.debug('genai-prices data fetch already in progress, skipping')
      return
    }

    console.debug('Fetching genai-prices data')
    isFetching = true

    // Note: **DO NOT** await this promise
    const freshDataPromise = fetch(remoteDataUrl)
      .then(async (response) => {
        if (!response.ok) {
          console.error('Failed fetching provider data, response status %d', response.status)
          return null
        }

        const freshData = (await response.json()) as Provider[]
        console.debug('Updated genai prices data, %d providers', freshData.length)
        genaiDataTimestamp = Date.now()
        return freshData
      })
      .catch((error: unknown) => {
        console.error('Failed fetching provider data err: %o', error)
        return null
      })
      .finally(() => {
        isFetching = false
      })

    setProviderData(freshDataPromise)
  })
  return waitForUpdate()
}
