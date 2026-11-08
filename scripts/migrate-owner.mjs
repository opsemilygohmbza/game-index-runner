import fs from 'node:fs/promises';
const path = 'list.json';
const list = JSON.parse(await fs.readFile(path, 'utf8'));
for (const game of list) {
  if (game.pagesUrl && !game.pagesUrl.startsWith('https://opsemilygohmbza.github.io/')) {
    game.migration = { previousStatus: game.status, previousPagesUrl: game.pagesUrl, recoveredAt: new Date().toISOString() };
    game.status = 'indexed';
    for (const key of ['pagesUrl','cover','checkedAt','runtime','runtimeStatus','lastCheckError']) delete game[key];
  }
}
await fs.writeFile(path, `${JSON.stringify(list, null, 2)}\n`);
console.log(`Recovered ${list.length} catalog records. Previous deployment is not treated as the new deployment.`);
