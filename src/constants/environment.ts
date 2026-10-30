/** Defaults that only apply on a developer machine; deployments must configure real values. */
export const LOCAL_DEFAULTS = {
  origin: 'http://localhost:3000',
  vapidSubject: 'mailto:ringgg-dev@localhost',
};

export const ENVIRONMENT_RULES = {
  cronSecretMinimumLength: 16,
  /** Base64url lengths of an uncompressed P-256 public key and its private scalar. */
  vapidPublicKeyLength: 87,
  vapidPrivateKeyLength: 43,
  /** Push providers reject or deprioritize placeholder contacts. */
  placeholderSubjectPattern: /example\.(com|org|net)|localhost/i,
};
