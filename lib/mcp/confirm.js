// Confirmation tokens for two-step destructive MCP tools. The first call returns a plan and a
// token; the second call (same tool, same arguments, same account) runs exactly that plan.
// Tokens are HMAC-SHA256 values over the canonical plan, the account and the arguments, keyed
// with a per-process secret, kept in memory only, single-use, and valid for 5 minutes.
import crypto from 'node:crypto';
import { CldshError, CODES } from '../errors.js';

export const TOKEN_TTL_SECONDS = 300;

/** JSON with sorted object keys, so equal values always serialize identically. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Arguments that identify the operation (everything except the confirmation controls). */
export function operationArgs(args) {
  const { confirm_token: _t, dry_run: _d, ...rest } = args || {};
  return canonical(rest);
}

function rejected(message) {
  return new CldshError(CODES.USAGE, message, {
    hint: 'Call the tool again without confirm_token to get a fresh plan and token.',
  });
}

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now] clock in ms (tests)
 * @param {number} [opts.ttlSeconds]
 */
export function createConfirmStore({ now = () => Date.now(), ttlSeconds = TOKEN_TTL_SECONDS } = {}) {
  const secret = crypto.randomBytes(32);
  const pending = new Map();

  const purge = () => {
    const t = now();
    for (const [token, entry] of pending) if (entry.expiresAt <= t) pending.delete(token);
  };

  return {
    ttlSeconds,
    /**
     * Remember `plan` for `tool` and return its token.
     * @param {{ tool: string, account: string, args: object, plan: any }} op
     */
    issue({ tool, account, args, plan }) {
      purge();
      const issuedAt = now();
      const argsKey = operationArgs(args);
      const token = crypto.createHmac('sha256', secret)
        .update(canonical({ tool, account, args: argsKey, plan, issuedAt }))
        .digest('base64url');
      pending.set(token, { tool, account, argsKey, plan, expiresAt: issuedAt + ttlSeconds * 1000 });
      return token;
    },
    /**
     * Consume a token: returns the stored plan, or throws when the token is unknown, expired, used,
     * or was issued for another tool, other arguments or another account.
     */
    redeem(token, { tool, account, args }) {
      const entry = pending.get(token);
      if (!entry) throw rejected('Unknown or already used confirm_token');
      if (entry.expiresAt <= now()) {
        pending.delete(token);
        throw rejected(`confirm_token expired (tokens are valid for ${ttlSeconds} seconds)`);
      }
      if (entry.tool !== tool) throw rejected(`This confirm_token was issued for ${entry.tool}, not ${tool}`);
      if (entry.account !== account) {
        pending.delete(token);
        throw new CldshError(CODES.CONFLICT, 'The active Cloudinary account changed since this confirm_token was issued; nothing was changed', {
          hint: 'Call the tool again without confirm_token to plan against the current account.',
        });
      }
      if (entry.argsKey !== operationArgs(args)) throw rejected('confirm_token does not match these arguments; nothing was changed');
      pending.delete(token);
      return entry.plan;
    },
    get size() { purge(); return pending.size; },
  };
}
