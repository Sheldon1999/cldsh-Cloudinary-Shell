// Human-readable formatting. Functions return strings; commands print them through ctx.out,
// so the same formatting works on stdout (shell, headless) and in tests.

export function formatBytes(n = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n) || 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i ? 1 : 0)} ${units[i]}`;
}

const DIR_TAG = '[DIR] ';
const INDENT = '      ';

/**
 * `ls` output. `long` adds size, dimensions, name, format and resource type columns.
 * @param {object} p
 * @param {string[]} p.folders
 * @param {object[]} p.files AssetRef[]
 * @param {boolean} [p.long]
 * @param {import('chalk').ChalkInstance} c
 */
export function formatList({ folders = [], files = [], long = false }, c) {
  const lines = folders.map(n => c.cyan(DIR_TAG) + n);
  if (!long) {
    for (const f of files) lines.push(INDENT + f.name);
    if (!lines.length) lines.push(c.dim('(empty)'));
    return lines.join('\n');
  }
  if (!files.length) {
    if (!lines.length) lines.push(c.dim('(empty)'));
    return lines.join('\n');
  }

  const rows = files.map(r => {
    const kb = typeof r.bytes === 'number' ? r.bytes / 1024 : null;
    return {
      size: kb == null ? '?' : (kb < 10 ? kb.toFixed(1) : String(Math.round(kb))),
      dims: r.width && r.height ? `${r.width}x${r.height}` : '-',
      name: r.name,
      format: r.format || '-',
      kind: r.type && r.type !== 'upload' ? `${r.resource_type}/${r.type}` : r.resource_type,
    };
  });
  const NAME_MAX = 48;
  const w = {
    size: Math.max('SIZE(KB)'.length, ...rows.map(r => r.size.length)),
    dims: Math.max('DIMENSIONS(px)'.length, ...rows.map(r => r.dims.length)),
    name: Math.min(NAME_MAX, Math.max('NAME'.length, ...rows.map(r => r.name.length))),
    format: Math.max('FORMAT'.length, ...rows.map(r => r.format.length)),
  };
  const lpad = (s, n) => String(s).padStart(n);
  const rpad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  const SEP = '  ';
  const row = (a, b, d, e, f) => INDENT + lpad(a, w.size) + SEP + rpad(b, w.dims) + SEP + rpad(d, w.name) + SEP + rpad(e, w.format) + SEP + f;

  lines.push('');
  lines.push(c.bold(row('SIZE(KB)', 'DIMENSIONS(px)', 'NAME', 'FORMAT', 'TYPE')));
  lines.push(c.dim(INDENT + ['─'.repeat(w.size), '─'.repeat(w.dims), '─'.repeat(w.name), '─'.repeat(w.format), '────'].join(SEP)));
  for (const r of rows) lines.push(row(r.size, r.dims, r.name, r.format, r.kind));
  return lines.join('\n');
}

/** ASCII tree for `tree`. Node: { name, path, dirs: Node[], files: AssetRef[], truncated? } */
export function formatTree(root, c) {
  const label = root.path ? root.path.split('/').pop() : '/';
  const lines = [c.bold(label)];
  const items = (node) => [
    ...node.dirs.map(d => ({ dir: d })),
    ...node.files.map(f => ({ file: f })),
    ...(node.truncated ? [{ more: true }] : []),
  ];
  const walk = (node, prefix) => {
    const list = items(node);
    list.forEach((it, i) => {
      const last = i === list.length - 1;
      const branch = prefix + (last ? '└── ' : '├── ');
      if (it.dir) {
        lines.push(branch + c.bold(it.dir.path.split('/').pop()));
        walk(it.dir, prefix + (last ? '    ' : '│   '));
      } else if (it.file) {
        lines.push(branch + it.file.name);
      } else {
        lines.push(branch + c.dim('… more (raise --max)'));
      }
    });
  };
  walk(root, '');
  return lines.join('\n');
}

/** `info` card. */
export function formatInfo(data = {}, c) {
  const labelW = 16;
  const lines = ['', '  ' + c.bold.underline(data.display_name || data.public_id || 'Asset Info')];
  const row = (label, val) => {
    if (val === undefined || val === null || val === '') return;
    lines.push('  ' + c.cyan(label.padEnd(labelW)) + ' ' + String(val));
  };
  row('Public ID:', data.public_id);
  row('Asset ID:', data.asset_id);
  row('Folder:', data.asset_folder ?? data.folder);
  row('Resource Type:', data.resource_type);
  row('Delivery Type:', data.type);
  row('Format:', data.format);
  if (data.width && data.height) row('Dimensions:', `${data.width} × ${data.height} px`);
  if (typeof data.bytes === 'number') row('File Size:', formatBytes(data.bytes));
  if (data.duration) row('Duration:', `${Number(data.duration).toFixed(1)} s`);
  row('Created At:', data.created_at);
  if (data.version) row('Version:', `v${data.version}`);
  if (Array.isArray(data.tags) && data.tags.length) row('Tags:', data.tags.join(', '));
  if (data.secure_url || data.url) row('URL:', c.green(data.secure_url || data.url));
  lines.push('');
  return lines.join('\n');
}
