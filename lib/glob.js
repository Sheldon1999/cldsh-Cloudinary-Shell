export function isGlob(pattern = '') {
  return /[*?]/.test(pattern);
}

export function globToRegex(pattern = '') {
  const escaped = (pattern || '').replace(/[.+^$(){}[\]|\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexStr, 'i');
}

export function matchGlob(str = '', pattern = '') {
  return globToRegex(pattern).test(str || '');
}

export function parseGlobTarget(currentCwd = '', targetArg = '') {
  const target = (targetArg || '').trim();
  if (!isGlob(target)) return null;

  const lastSlash = target.lastIndexOf('/');
  let folderPart = '';
  let filePattern = target;

  if (lastSlash !== -1) {
    folderPart = target.slice(0, lastSlash);
    filePattern = target.slice(lastSlash + 1);
  }

  return {
    folderPart,
    filePattern,
    regex: globToRegex(filePattern),
  };
}
