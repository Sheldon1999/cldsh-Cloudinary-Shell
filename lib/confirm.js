// Confirmation for destructive commands. Shows what will happen (and on which cloud) and asks;
// runs without a terminal refuse unless --yes was given.
import { CldshError, CODES } from './errors.js';

/**
 * @param {object} ctx command context
 * @param {object} opts
 * @param {string[]} opts.summaryLines plan summary (counts, first entries, cloud name)
 * @param {boolean} [opts.needsTypedCloud] the user must type the cloud name instead of y/N
 * @param {string} opts.cloudName
 * @returns {Promise<true>} resolves when confirmed; otherwise throws CldshError(ABORTED)
 */
export async function confirmDestructive(ctx, { summaryLines = [], needsTypedCloud = false, cloudName } = {}) {
  if (ctx.flags?.yes) return true;
  for (const line of summaryLines) ctx.out.warn(line);
  if (!ctx.interactive) {
    throw new CldshError(CODES.ABORTED, `Not deleting on cloud "${cloudName}" without confirmation (no terminal to ask)`, {
      hint: 'Check the plan with --dry-run, then add --yes to confirm.',
    });
  }
  if (needsTypedCloud) {
    const answer = await ctx.prompter.ask(`Type the cloud name "${cloudName}" to confirm: `);
    if (answer !== cloudName) throw new CldshError(CODES.ABORTED, 'Cancelled: the cloud name did not match; nothing was deleted');
    return true;
  }
  if (!(await ctx.prompter.confirm('Proceed?'))) throw new CldshError(CODES.ABORTED, 'Cancelled; nothing was deleted');
  return true;
}
