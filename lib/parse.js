export function parseLine(line = '') {
  const tokens = line.trim().match(/([^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (!tokens.length) return { cmd: '', args: [], flags: {} };
  const [cmd, ...rest] = tokens;
  const args = [];
  const flags = {};
  let i = 0;
  while (i < rest.length) {
    const t = rest[i];
    if (t.startsWith('--')) {
      const [k, v] = t.slice(2).split('=');
      if (v !== undefined) flags[k] = coerce(v);
      else if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) { flags[k] = coerce(rest[i + 1]); i++; }
      else flags[k] = true;
    } else if (t.startsWith('-') && t.length > 1) {
      const cluster = t.slice(1);
      if (cluster.length > 1) { cluster.split('').forEach(c => flags[c] = true); }
      else {
        const key = cluster;
        if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) { flags[key] = coerce(rest[i + 1]); i++; }
        else flags[key] = true;
      }
    } else args.push(stripQuotes(t));
    i++;
  }
  return { cmd, args, flags };
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (!isNaN(Number(v))) return Number(v);
  return v;
}
