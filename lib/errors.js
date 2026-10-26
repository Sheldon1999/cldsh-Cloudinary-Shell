// Error model shared by the shell, the headless CLI and the MCP server.
//
// The Cloudinary SDK rejects with plain objects (`{ error: { message, http_code } }`),
// not Error instances. Everything that talks to the SDK funnels failures through
// `toCldError` so callers always get a readable message and a stable code.

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  PARTIAL: 3,
  ABORTED: 4,
});

export const CODES = Object.freeze({
  AUTH: 'AUTH',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  NETWORK: 'NETWORK',
  USAGE: 'USAGE',
  PARTIAL: 'PARTIAL',
  ABORTED: 'ABORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  API: 'API',
  LOCAL: 'LOCAL',
});

const EXIT_BY_CODE = {
  [CODES.USAGE]: EXIT.USAGE,
  [CODES.PARTIAL]: EXIT.PARTIAL,
  [CODES.ABORTED]: EXIT.ABORTED,
};

export class CldshError extends Error {
  constructor(code, message, { hint, httpCode, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CldshError';
    this.code = code;
    if (hint) this.hint = hint;
    if (httpCode) this.httpCode = httpCode;
    if (details !== undefined) this.details = details;
  }

  get exitCode() {
    return EXIT_BY_CODE[this.code] ?? EXIT.ERROR;
  }

  toJSON() {
    const out = { code: this.code, message: this.message };
    if (this.hint) out.hint = this.hint;
    if (this.httpCode) out.http_code = this.httpCode;
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export const usageError = (message, hint) => new CldshError(CODES.USAGE, message, { hint });
export const notFound = (message, hint) => new CldshError(CODES.NOT_FOUND, message, { hint });

const NETWORK_ERRNOS = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT']);

function codeForHttp(status) {
  if (status === 401) return CODES.AUTH;
  if (status === 403) return CODES.FORBIDDEN;
  if (status === 404) return CODES.NOT_FOUND;
  if (status === 409) return CODES.CONFLICT;
  if (status === 420 || status === 429) return CODES.RATE_LIMITED;
  return CODES.API;
}

function hintFor(code, raw) {
  if (code === CODES.AUTH) return 'Check the API key and secret ("config" shows the active account).';
  if (code === CODES.RATE_LIMITED) {
    const reset = raw?.rate_limit_reset_at || raw?.error?.rate_limit_reset_at;
    return reset
      ? `Admin API hourly limit reached; it resets at ${new Date(reset).toISOString()}.`
      : 'Admin API hourly limit reached; wait for the hourly reset or use a plan with a higher limit.';
  }
  if (code === CODES.NETWORK) return 'Check the network connection to api.cloudinary.com.';
  return undefined;
}

/** Normalize anything thrown by the SDK, fetch, fs or our own code into a CldshError. */
export function toCldError(e) {
  if (e instanceof CldshError) return e;

  // SDK wraps socket failures as { error: <Error> } (e.g. ECONNRESET): classify the inner error.
  if (e && typeof e === 'object' && !(e instanceof Error) && e.error instanceof Error) return toCldError(e.error);

  // SDK shape: { error: { message, http_code }, request_options, ... }
  if (e && typeof e === 'object' && !(e instanceof Error) && e.error && typeof e.error === 'object') {
    const httpCode = e.error.http_code;
    const code = codeForHttp(httpCode);
    const message = e.error.message || `Cloudinary API error (${httpCode || 'unknown status'})`;
    return new CldshError(code, message, { httpCode, hint: hintFor(code, e) });
  }

  if (e instanceof Error) {
    const errno = e.code || e.cause?.code;
    if (NETWORK_ERRNOS.has(errno) || e.name === 'FetchError' || /fetch failed/i.test(e.message)) {
      return new CldshError(CODES.NETWORK, `Network error: ${e.cause?.message || e.message}`, { hint: hintFor(CODES.NETWORK), cause: e });
    }
    if (typeof e.http_code === 'number') {
      const code = codeForHttp(e.http_code);
      return new CldshError(code, e.message, { httpCode: e.http_code, hint: hintFor(code, e), cause: e });
    }
    if (errno && /^E[A-Z]+$/.test(errno)) {
      return new CldshError(CODES.LOCAL, e.message, { cause: e });
    }
    return new CldshError(CODES.API, e.message, { cause: e });
  }

  if (typeof e === 'string') return new CldshError(CODES.API, e);

  // Uploader shape: a plain object { message, http_code, name? }.
  if (e && typeof e === 'object' && typeof e.message === 'string') {
    const httpCode = typeof e.http_code === 'number' ? e.http_code : undefined;
    const code = httpCode ? codeForHttp(httpCode) : CODES.API;
    return new CldshError(code, e.message, { httpCode, hint: hintFor(code, e) });
  }

  // Never attach the raw object: SDK errors carry request_options.auth (api_key:api_secret).
  return new CldshError(CODES.API, 'Unknown error from the Cloudinary SDK');
}

/** Human one-liner for printing. */
export function formatError(e) {
  const err = toCldError(e);
  return err.hint ? `${err.message}\n  hint: ${err.hint}` : err.message;
}
