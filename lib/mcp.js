// Model Context Protocol server over stdio (`cldsh --mcp`).
//
// Transport: newline-delimited JSON-RPC 2.0. stdout carries protocol messages only; every log
// line goes to stderr. Requests run concurrently; `notifications/cancelled` aborts one.
// Supported protocol versions: 2025-06-18, 2025-03-26, 2024-11-05 (the client's version when
// supported, else the newest). Only the `tools` capability is advertised.
//
// Server options (after --mcp):
//   --read-only         list and allow only the read-only tools
//   --no-confirm        destructive tools run in one call (cldsh 1.0.0 behavior); warns at startup
//   --allow-path <dir>  additional local directory for uploads/downloads (repeatable)
import readline from 'node:readline';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.js';
import { CldshError, CODES, EXIT, toCldError, formatError, usageError } from './errors.js';
import { getActiveConfig } from './env.js';
import { getBackend } from './backend/index.js';
import { createSandbox } from './sandbox.js';
import { createConfirmStore } from './mcp/confirm.js';
import { validateArgs } from './mcp/schema.js';
import { TOOLS, OUTPUT_SCHEMA } from './mcp/tools.js';

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_VERSION = SUPPORTED_VERSIONS[0];
const STRUCTURED_SINCE = '2025-06-18';
const ROOTS_TIMEOUT_MS = 5000;

export const ERR = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
});

const SERVER_NAME = 'cloudinary-shell';

/**
 * Parse the server options from the process arguments.
 * @returns {{ readOnly: boolean, noConfirm: boolean, allowPaths: string[] }}
 */
export function parseServerArgs(argv = []) {
  const opts = { readOnly: false, noConfirm: false, allowPaths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mcp') continue;
    if (a === '--read-only') opts.readOnly = true;
    else if (a === '--no-confirm') opts.noConfirm = true;
    else if (a === '--allow-path' || a.startsWith('--allow-path=')) {
      const v = a === '--allow-path' ? argv[++i] : a.slice('--allow-path='.length);
      if (!v || v.startsWith('--')) throw usageError('--allow-path needs a directory');
      opts.allowPaths.push(v);
    } else {
      throw usageError(`Unknown option for the MCP server: ${a}`, 'options: --read-only, --no-confirm, --allow-path <dir>');
    }
  }
  return opts;
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function instructions({ readOnly, confirmRequired }) {
  const parts = ['Cloudinary paths start at the root folder ("" or "/").'];
  if (readOnly) parts.push('This server is read-only: tools that change the account are not available.');
  else if (confirmRequired) {
    parts.push('cloudinary_delete, cloudinary_move, cloudinary_rename_folder and uploads that would replace existing assets return needs_confirmation with a plan and a confirm_token instead of acting. Show the plan to the user and repeat the call with the same arguments plus confirm_token only after the user approves.');
  }
  parts.push('Local files for upload and download must be inside the allowed directories (see cloudinary_account).');
  return parts.join(' ');
}

/**
 * Create a protocol handler. Transport-independent: feed it parsed messages (`handleMessage`) or
 * raw lines (`handleLine`); it calls `send` for server-initiated messages and line responses.
 * @param {object} [o]
 * @param {(msg: object) => void} [o.send] writes one message to the client
 * @param {(line: string) => void} [o.log] diagnostics (stderr)
 * @param {boolean} [o.readOnly]
 * @param {boolean} [o.noConfirm]
 * @param {ReturnType<typeof createSandbox>} [o.sandbox]
 * @param {ReturnType<typeof createConfirmStore>} [o.confirm]
 * @param {number} [o.rootsTimeoutMs]
 */
export function createMcpServer({
  send = () => {},
  log = () => {},
  readOnly = false,
  noConfirm = false,
  sandbox = createSandbox(),
  confirm = createConfirmStore(),
  rootsTimeoutMs = ROOTS_TIMEOUT_MS,
} = {}) {
  const confirmRequired = !noConfirm;
  const tools = TOOLS.filter(t => !readOnly || t.annotations.readOnlyHint);
  const inflight = new Map();
  const running = new Set();
  const pendingRequests = new Map();
  let version = null;
  let clientCapabilities = {};
  let seq = 0;
  let rootsPromise = null;

  // ------------------------------------------------------------ server → client requests

  function request(method, params) {
    const id = `cldsh-${++seq}`;
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    });
  }

  function refreshRoots() {
    const fetch = request('roots/list').then((res) => {
      const dirs = [];
      for (const r of Array.isArray(res?.roots) ? res.roots : []) {
        if (typeof r?.uri !== 'string' || !r.uri.startsWith('file:')) continue;
        try { dirs.push(fileURLToPath(r.uri)); } catch { /* not a local path */ }
      }
      sandbox.setClientRoots(dirs);
      log(`client roots: ${sandbox.roots.join(', ') || '(none)'}`);
    }, (e) => log(`roots/list failed: ${e?.message || e}`));
    // Tool calls wait for the roots, but never longer than the timeout.
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, rootsTimeoutMs); timer.unref?.(); });
    rootsPromise = Promise.race([fetch, timeout]).finally(() => clearTimeout(timer));
  }

  function handleResponse(msg) {
    const p = pendingRequests.get(msg.id);
    if (!p) return;
    pendingRequests.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message || 'request failed'));
    else p.resolve(msg.result);
  }

  // ------------------------------------------------------------ notifications

  function handleNotification(method, params) {
    if (method === 'notifications/cancelled') {
      inflight.get(params?.requestId)?.abort(new CldshError(CODES.ABORTED, 'Cancelled by the client'));
    } else if (method === 'notifications/initialized') {
      if (clientCapabilities.roots) refreshRoots();
    } else if (method === 'notifications/roots/list_changed') {
      if (clientCapabilities.roots) refreshRoots();
    }
    // Everything else (unknown notifications included) is ignored: notifications never get a reply.
  }

  // ------------------------------------------------------------ tools

  const structured = () => (version ?? LATEST_VERSION) >= STRUCTURED_SINCE;

  function describeTool(t) {
    const description = confirmRequired && t.confirmNote ? `${t.description} ${t.confirmNote}` : t.description;
    return {
      name: t.name,
      title: t.title,
      description,
      inputSchema: t.inputSchema,
      ...(structured() ? { outputSchema: OUTPUT_SCHEMA } : {}),
      annotations: { title: t.title, ...t.annotations },
    };
  }

  function toolResult(data) {
    const obj = isObject(data) ? data : { result: data ?? null };
    return {
      content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
      ...(structured() ? { structuredContent: obj } : {}),
    };
  }

  function toolError(e) {
    const err = toCldError(e);
    let text = `Error (${err.code}): ${formatError(err)}`;
    if (err.details !== undefined) text += `\ndetails: ${JSON.stringify(err.details, null, 2)}`;
    return {
      isError: true,
      content: [{ type: 'text', text }],
      ...(structured() ? { structuredContent: { error: err.toJSON() } } : {}),
    };
  }

  const accountKey = (backend) => `${backend.cloudName}\0${getActiveConfig()?.api_key ?? ''}\0${backend.mode}`;

  async function callTool(id, params) {
    if (!isObject(params) || typeof params.name !== 'string') return fail(id, ERR.INVALID_PARAMS, 'tools/call needs params.name');
    const tool = tools.find(t => t.name === params.name);
    if (!tool) {
      const hidden = TOOLS.some(t => t.name === params.name);
      return fail(id, ERR.INVALID_PARAMS, hidden
        ? `Tool ${params.name} is not available: the server runs with --read-only`
        : `Unknown tool: ${params.name}`);
    }
    const args = params.arguments ?? {};
    const problems = validateArgs(tool.inputSchema, args);
    if (problems.length) return fail(id, ERR.INVALID_PARAMS, `Invalid arguments for ${tool.name}: ${problems.join('; ')}`, { problems });

    const ac = new AbortController();
    if (id !== undefined) inflight.set(id, ac);
    const env = {
      backend: () => getBackend(getActiveConfig()),
      sandbox,
      confirm,
      confirmRequired,
      accountKey,
      signal: ac.signal,
      rootsReady: () => rootsPromise ?? Promise.resolve(),
      server: { readOnly },
    };
    try {
      const data = await tool.handler(args, env);
      if (ac.signal.aborted) return null;
      return reply(id, toolResult(data));
    } catch (e) {
      if (ac.signal.aborted) return null;
      return reply(id, toolError(e));
    } finally {
      if (inflight.get(id) === ac) inflight.delete(id);
    }
  }

  // ------------------------------------------------------------ requests

  async function handleRequest(id, method, params) {
    switch (method) {
      case 'initialize': {
        const requested = isObject(params) ? params.protocolVersion : undefined;
        version = SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION;
        clientCapabilities = isObject(params?.capabilities) ? params.capabilities : {};
        const client = params?.clientInfo?.name ? `${params.clientInfo.name} ${params.clientInfo.version ?? ''}`.trim() : 'unknown client';
        log(`initialize from ${client}: protocol ${version}${requested !== version ? ` (requested ${requested ?? 'none'})` : ''}`);
        return reply(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, ...(version >= STRUCTURED_SINCE ? { title: 'Cloudinary Shell' } : {}), version: VERSION },
          instructions: instructions({ readOnly, confirmRequired }),
        });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: tools.map(describeTool) });
      case 'tools/call':
        return callTool(id, params);
      // Not advertised, answered for clients (e.g. the MCP Inspector) that ask anyway.
      case 'resources/list':
        return reply(id, { resources: [] });
      case 'resources/templates/list':
        return reply(id, { resourceTemplates: [] });
      case 'prompts/list':
        return reply(id, { prompts: [] });
      default:
        return fail(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  /**
   * Handle one parsed JSON-RPC message (or batch).
   * @returns {Promise<object | object[] | null>} the response, or null when none is due
   */
  async function handleMessage(msg) {
    if (Array.isArray(msg)) {
      if (!msg.length) return fail(null, ERR.INVALID_REQUEST, 'Invalid Request: empty batch');
      const out = (await Promise.all(msg.map(handleMessage))).filter(Boolean);
      return out.length ? out : null;
    }
    if (!isObject(msg)) return fail(null, ERR.INVALID_REQUEST, 'Invalid Request: expected a JSON object');
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');

    if (msg.method === undefined) {
      if (hasId && ('result' in msg || 'error' in msg)) {
        handleResponse(msg);
        return null;
      }
      return fail(hasId ? msg.id : null, ERR.INVALID_REQUEST, 'Invalid Request: missing method');
    }
    if (!hasId) {
      if (typeof msg.method === 'string') handleNotification(msg.method, msg.params);
      return null;
    }
    if (typeof msg.method !== 'string' || (typeof msg.id !== 'string' && typeof msg.id !== 'number')) {
      return fail(typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null, ERR.INVALID_REQUEST, 'Invalid Request');
    }
    try {
      return await handleRequest(msg.id, msg.method, msg.params);
    } catch (e) {
      log(`internal error in ${msg.method}: ${e?.stack || e}`);
      return fail(msg.id, ERR.INTERNAL, `Internal error: ${e?.message || e}`);
    }
  }

  /** Handle one input line; writes the response (if any) through `send`. */
  function handleLine(line) {
    const trimmed = String(line).trim();
    if (!trimmed) return Promise.resolve();
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send(fail(null, ERR.PARSE, 'Parse error'));
      return Promise.resolve();
    }
    const job = handleMessage(msg).then((res) => { if (res) send(res); });
    running.add(job);
    job.finally(() => running.delete(job));
    return job;
  }

  return {
    handleMessage,
    handleLine,
    /** Resolves once every request received so far has been answered. */
    async idle() {
      while (running.size) await Promise.allSettled([...running]);
    },
    get tools() { return tools.map(t => t.name); },
    get protocolVersion() { return version; },
    get sandbox() { return sandbox; },
  };
}

/**
 * Run the stdio server until stdin closes. Called by lib/main.js after credentials were loaded.
 * @param {object} o
 * @param {string[]} [o.argv] process arguments (server options follow --mcp)
 * @param {{ configured: boolean, source: string|null, cloud_name: string|null }} [o.startup]
 */
export async function runMcpServer({ argv = [], startup } = {}) {
  const log = (s) => process.stderr.write(`[cldsh mcp] ${s}\n`);
  let opts;
  let sandbox;
  try {
    opts = parseServerArgs(argv);
    sandbox = createSandbox();
    for (const p of opts.allowPaths) sandbox.addRoot(p);
  } catch (e) {
    process.stderr.write(`${formatError(e)}\n`);
    process.exitCode = EXIT.USAGE;
    return;
  }

  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const server = createMcpServer({ send, log, readOnly: opts.readOnly, noConfirm: opts.noConfirm, sandbox });

  log(`cloudinary-shell ${VERSION} MCP server on stdio`);
  if (startup?.configured) log(`account: ${startup.cloud_name} (${startup.source})`);
  else log('no Cloudinary credentials found: set CLOUDINARY_URL or run "cldsh login"; tool calls fail until then');
  if (opts.readOnly) log('read-only mode: only read-only tools are available');
  if (opts.noConfirm) log('WARNING: --no-confirm: deletes, moves and overwriting uploads run without a confirmation step');
  log(`local files allowed under: ${sandbox.roots.join(', ') || '(none)'}`);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  for await (const line of rl) server.handleLine(line);
  await server.idle();
}
