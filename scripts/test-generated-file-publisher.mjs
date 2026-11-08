import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeCatalog,publishCatalog} from './generated-file-publisher-lib.mjs';
import {normalizeCatalog} from './catalog-normalization.mjs';

test('upstream duplicate repositories and reused IDs normalize deterministically',()=>{
  const records=[{id:'same',owner:'A',name:'Game',repo:'https://github.com/A/Game'}, {id:'same',owner:'a',name:'game',repo:'https://github.com/A/Game'}, {id:'same',owner:'B',name:'Game',repo:'https://github.com/B/Game'}];
  const normalized=normalizeCatalog(records);
  assert.equal(normalized.length,2);
  assert.equal(new Set(normalized.map(game=>game.id)).size,2);
  assert.deepEqual(normalizeCatalog(normalized),normalized);
});

test('8 concurrent writers preserve fields after 28 forced SHA conflicts', async()=>{
  const base=[{id:'game',title:'original'}];
  let current=structuredClone(base),revision=0,conflicts=0;
  await Promise.all(Array.from({length:8},(_,i)=>publishCatalog({base,generated:[{...base[0],[`field${i}`]:i}],maxAttempts:10,delay:async()=>{},
    read:async()=>({content:structuredClone(current),sha:revision}),
    write:async(content,sha)=>{if(sha!==revision){conflicts++;return 409;}current=content;revision++;return 200;}
  })));
  assert.equal(conflicts,28);
  for(let i=0;i<8;i++)assert.equal(current[0][`field${i}`],i);
});
test('concurrent additions and newer validation survive stale updates',()=>{
  const base=[{id:'a',title:'old',status:'indexed',checkedAt:'2026-07-01T00:00:00Z'}];
  const result=mergeCatalog(base,[{...base[0],title:'new',status:'check_error'}],[{...base[0],status:'verified',checkedAt:'2026-11-08T00:00:00Z'},{id:'b',title:'other'}]);
  assert.equal(result.length,2);assert.equal(result[0].title,'new');assert.equal(result[0].status,'verified');
});
