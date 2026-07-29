export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
];

export const CONTENT_SECURITY_POLICY = CSP_DIRECTIVES.join('; ');

export function buildContentSecurityPolicy(nonce?: string) {
  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
  ].join('; ');
}
