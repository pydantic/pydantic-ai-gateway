export const ctHeader = (contentType: string) => ({ 'Content-Type': contentType })

export const textResponse = (status: number, message: string) =>
  new Response(message, { status, headers: ctHeader('text/plain') })
export const jsonResponse = (data: any) =>
  new Response(JSON.stringify(data, null, 2) + '\n', { headers: ctHeader('application/json') })

export function response405(...allowMethods: string[]): Response {
  const allow = allowMethods.join(', ')
  return new Response(`405: Method not allowed, Allowed: ${allow}`, {
    status: 405,
    headers: { allow, ...ctHeader('text/plain') },
  })
}

function getIP(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) {
    return ip
  } else {
    throw new Error('IP address not found')
  }
}

export class ResponseError extends Error {
  status: number
  message: string

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.message = message
  }

  response(): Response {
    return textResponse(this.status, this.message)
  }
}
