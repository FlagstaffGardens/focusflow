import { NextRequest, NextResponse } from 'next/server'

const USERNAME = process.env.BASIC_AUTH_USER
const PASSWORD = process.env.BASIC_AUTH_PASSWORD
const REALM = 'FocusFlow'

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    },
  })
}

export function middleware(request: NextRequest) {
  if (!USERNAME || !PASSWORD) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/public') ||
    pathname.startsWith('/assets') ||
    pathname === '/robots.txt' ||
    pathname === '/manifest.json'
  ) {
    return NextResponse.next()
  }

  const authorization = request.headers.get('authorization')
  if (!authorization) {
    return unauthorized()
  }

  const [scheme, encoded] = authorization.split(' ')
  if (scheme !== 'Basic' || !encoded) {
    return unauthorized()
  }

  let decoded: string
  try {
    decoded = globalThis.atob(encoded)
  } catch {
    return unauthorized()
  }

  const separator = decoded.indexOf(':')
  if (separator === -1) {
    return unauthorized()
  }

  const user = decoded.slice(0, separator)
  const pass = decoded.slice(separator + 1)

  if (user !== USERNAME || pass !== PASSWORD) {
    return unauthorized()
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/|favicon\.ico).*)'],
}
