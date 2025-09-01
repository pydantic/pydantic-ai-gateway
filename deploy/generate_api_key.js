// Script to generate a random API key

function tokenUrlSafe(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

console.log(tokenUrlSafe(32))
