const COMMAND_FLAGS = {
  ls: ['-l', '--rt=image', '--rt=video', '--rt=raw'],
  cd: ['..', '/', '-'],
  upload: ['-r', '-o', '-v', '--rt=image', '--rt=video', '--rt=raw', '--dry-run', '--concurrency='],
  rm: ['-rf', '--rt=image', '--rt=video', '--rt=raw', '--dry-run'],
  mv: ['-o', '--rt=image', '--rt=video', '--rt=raw', '--dry-run'],
  url: ['--t=', '--signed', '--type=authenticated', '--rt=image', '--rt=video', '--rt=raw'],
  info: ['--rt=image', '--rt=video', '--rt=raw'],
  view: ['--t=', '--rt=image', '--rt=video'],
  preview: ['--t=', '--rt=image', '--rt=video'],
};

// Pure completion resolution for testing & readline
export function matchCompletions(line = '', commands = [], folders = []) {
  const trimmedLeading = line.trimStart();
  if (!trimmedLeading) {
    return [commands, ''];
  }

  // Tokenize preserving trailing spaces
  const endsWithSpace = /\s$/.test(line);
  const parts = trimmedLeading.split(/\s+/);

  if (parts.length === 1 && !endsWithSpace) {
    const prefix = parts[0];
    const hits = commands.filter(c => c.startsWith(prefix));
    return [hits, prefix];
  }

  const cmd = parts[0];
  const currentToken = endsWithSpace ? '' : parts[parts.length - 1];

  // Flag completion
  if (currentToken.startsWith('-')) {
    const availableFlags = COMMAND_FLAGS[cmd] || [];
    const hits = availableFlags.filter(f => f.startsWith(currentToken));
    return [hits, currentToken];
  }

  // Folder completion for filesystem-like commands
  if (['cd', 'ls', 'rm', 'mv'].includes(cmd)) {
    const hits = folders.filter(f => f.startsWith(currentToken));
    return [hits, currentToken];
  }

  return [[], currentToken];
}

// Stateful completer with folder cache for interactive readline REPL
export function createCompleter(ctx, commandsList = []) {
  const folderCache = new Map(); // path -> { folders: [], exp: number }
  const TTL_MS = 15000;

  async function getFolders(path) {
    const key = path || '';
    const now = Date.now();
    const cached = folderCache.get(key);
    if (cached && cached.exp > now) {
      return cached.folders;
    }

    try {
      const folders = key
        ? await ctx.utils.subFolders(key)
        : await ctx.utils.rootFolders();
      folderCache.set(key, { folders, exp: now + TTL_MS });
      return folders;
    } catch {
      return [];
    }
  }

  function invalidateCache(path) {
    if (path !== undefined) {
      folderCache.delete(path);
    } else {
      folderCache.clear();
    }
  }

  // Attach invalidator to ctx for commands like mkdir, rm
  ctx.invalidateFolderCache = invalidateCache;

  return function completer(line, callback) {
    const trimmedLeading = line.trimStart();
    const parts = trimmedLeading.split(/\s+/);
    const endsWithSpace = /\s$/.test(line);

    // If only command is being typed, return immediately without network call
    if (parts.length === 1 && !endsWithSpace) {
      const [hits, prefix] = matchCompletions(line, commandsList, []);
      return callback(null, [hits, prefix]);
    }

    // If completing folders, fetch from cache/API
    const cmd = parts[0];
    if (['cd', 'ls', 'rm', 'mv'].includes(cmd)) {
      getFolders(ctx.cwd)
        .then(folders => {
          const [hits, prefix] = matchCompletions(line, commandsList, folders);
          callback(null, [hits, prefix]);
        })
        .catch(() => {
          callback(null, [[], '']);
        });
      return;
    }

    // Fallback: flags or no completion
    const [hits, prefix] = matchCompletions(line, commandsList, []);
    callback(null, [hits, prefix]);
  };
}
