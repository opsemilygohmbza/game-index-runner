export function mergeCatalog(base, generated, current) {
  const original = new Map(base.map(game => [game.id,game]));
  const merged = new Map(current.map(game => [game.id,structuredClone(game)]));
  for (const game of generated) {
    const before = original.get(game.id);
    if (!before) { if (!merged.has(game.id)) merged.set(game.id,structuredClone(game)); continue; }
    const latest = merged.get(game.id);
    if (!latest) continue; // do not resurrect a concurrently removed record.
    const staleCheck = game.checkedAt && latest.checkedAt && Date.parse(game.checkedAt) < Date.parse(latest.checkedAt);
    const checkFields = new Set(['status','checkedAt','pagesUrl','cover','entryPath','validationScore','lastCheckError','dataSize','runtime']);
    for (const key of new Set([...Object.keys(before),...Object.keys(game)])) {
      if (JSON.stringify(before[key]) === JSON.stringify(game[key])) continue;
      if (staleCheck && checkFields.has(key)) continue;
      if (key in game) latest[key] = structuredClone(game[key]); else delete latest[key];
    }
  }
  return [...merged.values()].sort((a,b) => a.id.localeCompare(b.id));
}

export async function publishCatalog({base,generated,read,write,maxAttempts=6,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  for (let attempt=0;attempt<maxAttempts;attempt++) {
    const {content,sha} = await read();
    const merged = mergeCatalog(base,generated,content);
    if (JSON.stringify(merged) === JSON.stringify(content)) return {changed:false,attempts:attempt+1};
    const status = await write(merged,sha);
    if (status === 200 || status === 201) return {changed:true,attempts:attempt+1};
    if (![409,422].includes(status)) throw new Error(`Catalog publication failed HTTP ${status}`);
    await delay(Math.min(2000,250*(attempt+1)));
  }
  throw new Error('Catalog publication exhausted SHA-conflict retries');
}
