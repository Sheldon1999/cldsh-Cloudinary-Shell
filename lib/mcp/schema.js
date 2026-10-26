// Validation of MCP tool arguments against the tool's `inputSchema` (the JSON Schema subset the
// tools use: object with typed properties, enums, required keys, no unknown keys). Runs before any
// handler, so a bad payload never reaches Cloudinary; failures become JSON-RPC error -32602.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v, type) {
  const t = typeOf(v);
  if (type === 'number') return (t === 'number' || t === 'integer') && Number.isFinite(v);
  return t === type;
}

function checkValue(name, value, prop) {
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  if (prop.type && !types.some(t => matchesType(value, t))) {
    return `"${name}" must be of type ${types.join(' or ')} (got ${typeOf(value)})`;
  }
  if (prop.enum && !prop.enum.includes(value)) {
    return `"${name}" must be one of: ${prop.enum.map(v => JSON.stringify(v)).join(', ')} (got ${JSON.stringify(value)})`;
  }
  if (typeof value === 'number' && prop.minimum !== undefined && value < prop.minimum) {
    return `"${name}" must be >= ${prop.minimum} (got ${value})`;
  }
  if (typeof value === 'string' && prop.minLength !== undefined && value.length < prop.minLength) {
    return `"${name}" must not be empty`;
  }
  if (Array.isArray(value) && prop.items) {
    for (let i = 0; i < value.length; i++) {
      const err = checkValue(`${name}[${i}]`, value[i], prop.items);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Validate `args` against an object `schema`.
 * @returns {string[]} problems (empty when valid)
 */
export function validateArgs(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeOf(args) !== 'object') return [`arguments must be an object (got ${typeOf(args)})`];
  const props = schema.properties || {};
  const problems = [];
  for (const key of schema.required || []) {
    if (args[key] === undefined) problems.push(`missing required argument "${key}"`);
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        problems.push(`unknown argument "${key}" (expected: ${Object.keys(props).join(', ') || 'none'})`);
      }
      continue;
    }
    if (value === undefined) continue;
    const err = checkValue(key, value, prop);
    if (err) problems.push(err);
  }
  return problems;
}
