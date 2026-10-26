// Output channels. Data (command results) goes to stdout; progress, warnings and errors go to
// stderr, so `cldsh ls --json | jq` always receives clean JSON. Colors are disabled when the
// stream is not a terminal or NO_COLOR is set.
import process from 'node:process';
import { Chalk } from 'chalk';

function colorLevel(stream) {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return 0;
  if (process.env.FORCE_COLOR === '0') return 0;
  if (process.env.FORCE_COLOR) return 1;
  return stream?.isTTY ? 3 : 0;
}

/**
 * @param {object} opts
 * @param {NodeJS.WritableStream} [opts.stdout]
 * @param {NodeJS.WritableStream} [opts.stderr]
 * @param {boolean} [opts.json] JSON mode: human `print` output is suppressed
 * @param {boolean} [opts.quiet] suppress `info`/`progress`
 */
export function createOutput({ stdout = process.stdout, stderr = process.stderr, json = false, quiet = false } = {}) {
  const c = new Chalk({ level: colorLevel(stdout) });
  const e = new Chalk({ level: colorLevel(stderr) });
  const line = (stream, s = '') => stream.write(String(s) + '\n');
  let jsonMode = json;

  return {
    /** JSON mode: human `print`/`success` output is suppressed (set per command by the dispatcher). */
    get json() { return jsonMode; },
    set json(v) { jsonMode = Boolean(v); },
    /** Chalk instance for stdout text. */
    c,
    /** Chalk instance for stderr text. */
    ce: e,
    /** Human-readable command result (stdout). Suppressed in JSON mode. */
    print(s = '') { if (!jsonMode) line(stdout, s); },
    /** Machine-readable result (stdout). */
    data(obj) { line(stdout, JSON.stringify(obj, null, 2)); },
    /** Raw write to stdout (terminal image escape sequences etc.). */
    raw(s) { stdout.write(s); },
    info(s = '') { if (!quiet) line(stderr, e.dim(s)); },
    progress(s = '') { if (!quiet) line(stderr, s); },
    success(s = '') { if (!jsonMode) line(stdout, c.green(s)); },
    warn(s = '') { line(stderr, e.yellow(s)); },
    error(s = '') { line(stderr, e.red(s)); },
  };
}
