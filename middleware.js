import { NextResponse } from 'next/server'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// These paths are allowed to mutate even when a preview session is active.
// /api/preview-session DELETE is needed to exit the preview; GET/POST are needed
// to start one. /api/preview-tests GET is read-only but listed for clarity.
const PREVIEW_EXEMPT = new Set(['/api/preview-session'])

export function middleware(request) {
  const { pathname } = request.nextUrl

  // Only intercept API routes
  if (!pathname.startsWith('/api/')) return NextResponse.next()

  // If no preview cookie, nothing to do
  const previewCookie = request.cookies.get('nvc_preview')?.value
  if (!previewCookie) return NextResponse.next()

  // Allow exempted paths (preview management) regardless of method
  if (PREVIEW_EXEMPT.has(pathname)) return NextResponse.next()

  // Block all mutations while a preview session is active
  if (MUTATION_METHODS.has(request.method)) {
    return NextResponse.json(
      {
        error:
          'This action is disabled in role preview mode. Click "Exit Preview" in the top banner to make changes.',
      },
      { status: 403 }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
