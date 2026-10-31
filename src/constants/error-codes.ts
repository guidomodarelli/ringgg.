/** Error codes the server sends in a response's `code` and the client reacts to, beyond showing the message. */
export const ERROR_CODES = {
  authRequired: 'AUTH_REQUIRED',
  locationRequired: 'LOCATION_REQUIRED',
  locationImprecise: 'LOCATION_IMPRECISE',
  tooFar: 'TOO_FAR',
} as const satisfies Record<string, string>;
