export function verify(
  _rawBody: Buffer,
  _headers: Readonly<Record<string, string>>,
): 'VERIFIED' | 'REJECTED' {
  throw new Error('not implemented');
}
