import chalk from 'chalk';

export const dim = (s) => chalk.dim(s);
export const error = (s) => chalk.red(s);
export const ok = (s) => chalk.green(s);
export const warn = (s) => chalk.yellow(s);
export const dir = (s) => chalk.cyan('[DIR] ') + s;
export const file = (s) => '      ' + s;
export const strong = (s) => chalk.bold(s);
export const println = (s='') => console.log(s);

export function printList({ folders = [], files = [], long = false }) {
  const LEFT = '      '; // six spaces to match [DIR] indent

  // show folders first
  if (folders.length) folders.forEach(n => println(dir(n)));

  if (!long) {
    if (files.length) files.forEach(r => println(file(r.display)));
    if (!folders.length && !files.length) println(dim('(empty)'));
    return;
  }

  // ----- long listing with header -----
  const rows = (files || []).map(r => {
    const kb = (typeof r.bytes === 'number') ? (r.bytes / 1024) : null;
    const size = (kb == null) ? '?' : (kb < 10 ? kb.toFixed(1) : String(Math.round(kb)));
    const dims = (r.width && r.height) ? `${r.width}x${r.height}` : '?x?';
    const name = r.display;
    const type = r.format || (r.resource_type === 'raw' ? 'raw' : (r.resource_type || '?'));
    return { size, dims, name, type };
  });

  if (!rows.length && !folders.length) {
    println(dim('(empty)'));
    return;
  }

  const NAME_MAX = 48;
  const sizeW = Math.max('SIZE(KB)'.length, ...rows.map(r => r.size.length || 0));
  const dimsW = Math.max('DIMENSIONS(px)'.length, ...rows.map(r => r.dims.length || 0));
  const typeW = Math.max('TYPE'.length, ...rows.map(r => r.type.length || 0));
  const nameW = Math.min(
    Math.max('NAME'.length, ...rows.map(r => (r.name || '').length)),
    NAME_MAX
  );

  const lpad = (s, w) => String(s).padStart(w);
  const rpad = (s, w) => {
    s = String(s);
    if (s.length > w) return s.slice(0, Math.max(0, w - 1)) + '…';
    return s.padEnd(w);
  };

  // spacing between columns
  const SEP = '  ';

  // Header (indented)
  println('');
  println(
    LEFT +
    chalk.bold(
      lpad('SIZE(KB)', sizeW) + SEP +
      rpad('DIMENSIONS(px)', dimsW) + SEP +
      rpad('NAME', nameW) + SEP +
      rpad('TYPE', typeW)
    )
  );
  println(
    LEFT +
    chalk.dim(
      '─'.repeat(sizeW) + SEP +
      '─'.repeat(dimsW) + SEP +
      '─'.repeat(nameW) + SEP +
      '─'.repeat(typeW)
    )
  );

  // Rows (indented)
  rows.forEach(r => {
    const line =
      lpad(r.size, sizeW) + SEP +
      rpad(r.dims, dimsW) + SEP +
      rpad(r.name, nameW) + SEP +
      rpad(r.type, typeW);
    println(LEFT + line);
  });
}


export function formatBytes(n = 0) {
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (n >= 1024 && i < units.length-1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${units[i]}`;
}

export function printTree(root) {
  const label = root.name === '/' ? '/' : root.name.split('/').pop();
  println(strong(label));

  const toItems = (node) => ([
    ...node.dirs.map(d => ({ kind: 'dir', node: d })),
    ...node.files.map(f => ({ kind: 'file', file: f })),
  ]);

  function walk(items, prefix) {
    items.forEach((it, idx) => {
      const last = idx === items.length - 1;
      const branch = prefix + (last ? '└── ' : '├── ');
      if (it.kind === 'dir') {
        const name = it.node.name.split('/').pop();
        println(branch + strong(name));
        const childPrefix = prefix + (last ? '    ' : '│   ');
        walk(toItems(it.node), childPrefix);
      } else {
        println(branch + it.file.public_id.split('/').pop());
      }
    });
  }

  walk(toItems(root), '');
}

