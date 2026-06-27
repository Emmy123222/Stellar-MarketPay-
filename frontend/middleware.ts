import { NextRequest, NextResponse } from "next/server";
import { buildContentSecurityPolicy } from "./lib/csp";

export function middleware(request: NextRequest) {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy(nonce));

  return response;
}

export const config = {
  matcher: [
    /*
     * Skip Next.js internals, API routes, and static assets while still
     * applying CSP to every rendered page.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
