// Interactive questions (login, confirmations). The shell passes its readline interface;
// headless runs create a temporary one when a terminal is attached, and refuse otherwise.
import readline from 'node:readline';
import process from 'node:process';
import { CldshError, CODES, usageError } from './errors.js';

const notInteractive = (what) => new CldshError(CODES.ABORTED, `${what} needs an interactive terminal`, {
  hint: 'Pass the value on the command line or stdin, or add --yes to confirm in scripts.',
});

function withTempInterface(input, output, fn) {
  const rl = readline.createInterface({ input, output, terminal: true });
  return fn(rl).finally(() => rl.close());
}

function questionOn(rl, query, { secret = false } = {}) {
  return new Promise((resolve, reject) => {
    let restore = null;
    if (secret) {
      // Hide typed characters: readline echoes through _writeToOutput.
      const original = rl._writeToOutput;
      let prompted = false;
      rl._writeToOutput = function writeMasked(s) {
        if (!prompted) { prompted = true; original.call(rl, s); return; }
        if (s.includes('\n') || s.includes('\r')) original.call(rl, '\n');
      };
      restore = () => { rl._writeToOutput = original; };
    }
    const onClose = () => { restore?.(); reject(new CldshError(CODES.ABORTED, 'Input closed')); };
    rl.once('close', onClose);
    rl.question(query, (answer) => {
      rl.off('close', onClose);
      restore?.();
      if (secret && Array.isArray(rl.history) && rl.history[0] === answer) rl.history.shift();
      resolve(answer.trim());
    });
  });
}

/**
 * @param {object} opts
 * @param {readline.Interface} [opts.rl] the shell's interface (REPL mode)
 * @param {NodeJS.ReadableStream} [opts.input]
 * @param {NodeJS.WritableStream} [opts.output] prompts go to stderr in headless mode so stdout stays data-only
 */
export function createPrompter({ rl = null, input = process.stdin, output = process.stderr } = {}) {
  const interactive = Boolean(rl) || Boolean(input.isTTY);

  const ask = (query, opts) => {
    if (rl) return questionOn(rl, query, opts);
    if (!input.isTTY) return Promise.reject(notInteractive('This question'));
    return withTempInterface(input, output, (tmp) => questionOn(tmp, query, opts));
  };

  return {
    interactive,
    ask: (query) => ask(query),
    askSecret: (query) => ask(query, { secret: true }),
    /** Yes/no question; default No. */
    async confirm(query) {
      if (!interactive) throw notInteractive('Confirmation');
      const answer = (await ask(`${query} [y/N] `)).toLowerCase();
      return answer === 'y' || answer === 'yes';
    },
  };
}

/** Read all of stdin (for `login --stdin`). */
export async function readStdin(input = process.stdin) {
  if (input.isTTY) throw usageError('--stdin expects piped input', 'e.g. printf %s "$CLOUDINARY_URL" | cldsh login prod --stdin');
  let data = '';
  for await (const chunk of input) data += chunk;
  return data;
}
