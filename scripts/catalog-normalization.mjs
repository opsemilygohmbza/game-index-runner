import crypto from 'node:crypto';
export function isOwnPagesUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && ['opsemilygohmbza.github.io', 'yx.ecy.al'].includes(url.hostname);
  } catch { return false; }
}

export function normalizeCatalog(entries) {
  const bySource = new Map();
  for (const game of entries) {
    if (!game?.owner || !game?.name || !game?.repo) continue;
    const key = `${game.owner}/${game.name}`.toLowerCase();
    const old = bySource.get(key);
    const newer = !old || (Date.parse(game.checkedAt || 0) || 0) >= (Date.parse(old.checkedAt || 0) || 0);
    bySource.set(key, newer ? {...old,...game} : {...game,...old});
  }
  const ids = new Set();
  return [...bySource.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,game]) => {
    let id = game.id || key.replace(/[^a-z0-9._-]/g,'-');
    if (ids.has(id)) id = `${id}-${crypto.createHash('sha256').update(key).digest('hex').slice(0,12)}`;
    ids.add(id);
    return {...game,id};
  });
}
