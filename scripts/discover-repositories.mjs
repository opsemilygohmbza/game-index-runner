import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const token = process.env.GITHUB_TOKEN || process.env.WEBRPG_SEARCH_TOKEN;
if (!token) throw new Error('A repository-scoped GITHUB_TOKEN is required');
const list = JSON.parse(await fs.readFile('list.json','utf8'));
const keys = new Set(list.map(game => `${game.owner}/${game.name}`.toLowerCase()));
const ids = new Set(list.map(game => game.id));
const queries = [
  ['topic:rpg-maker-mv archived:false fork:false','RPG Maker MV'],
  ['topic:rpg-maker-mz archived:false fork:false','RPG Maker MZ'],
  ['"RPG Maker" "web" in:description archived:false fork:false','RPG Maker'],
];
let added = 0;
for (let i=0;i<queries.length;i++) {
  const [query,engine] = queries[i];
  if (i) await new Promise(resolve => setTimeout(resolve,8000));
  const url = new URL('https://api.github.com/search/repositories');
  url.search = new URLSearchParams({q:query,per_page:'50',sort:'updated',order:'desc'});
  const response = await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Repository search HTTP ${response.status}: ${query}`);
  const result = await response.json();
  for (const repo of result.items || []) {
    if (repo.owner.login.toLowerCase() === 'opsemilygohmbza' || keys.has(repo.full_name.toLowerCase())) continue;
    const base = `${repo.owner.login}-${repo.name}`.toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
    let id = base;
    if (ids.has(id)) id += `-${crypto.createHash('sha256').update(repo.full_name).digest('hex').slice(0,8)}`;
    list.push({id,title:repo.name,repo:repo.html_url,owner:repo.owner.login,name:repo.name,engine,status:'indexed',source:'github-repository-search',discoveredAt:new Date().toISOString()});
    keys.add(repo.full_name.toLowerCase()); ids.add(id); added++;
  }
}
await fs.writeFile('list.json',`${JSON.stringify(list,null,2)}\n`);
console.log(`Repository discovery added ${added} candidates; none are marked playable before technical validation.`);
