import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeCatalog,publishCatalog} from './generated-file-publisher-lib.mjs';
import {normalizeCatalog,isOwnPagesUrl} from './catalog-normalization.mjs';

test('both own domains survive sync, foreign or credentialed URLs are rejected',()=>{
  for(const url of ['https://yx.ecy.al/A-Game/','https://opsemilygohmbza.github.io/A-Game/'])assert.equal(isOwnPagesUrl(url),true);
  for(const url of ['https://webrpg.org/A-Game/','https://yx.ecy.al.evil.example/A-Game/','http://yx.ecy.al/A-Game/','https://user:secret@yx.ecy.al/','invalid'])assert.equal(isOwnPagesUrl(url),false);
});

test('real upstream sync retains custom-domain publication and rejects foreign publication', async()=>{
  const fs=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const path=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const {promisify}=await import('node:util');
  const {execFile}=await import('node:child_process');
  const dir=await fs.mkdtemp(path.join(tmpdir(),'rpg-sync-regression-'));
  try{
    const records=['one','two'].map((name,i)=>({id:name,owner:'fixture',name,repo:`https://github.com/fixture/${name}`,title:name,status:'verified',pagesUrl:i?'https://webrpg.org/foreign/':'https://yx.ecy.al/fixture-one/',entryPath:'Nested/index.html',checkedAt:'2026-11-08T00:00:00Z'}));
    const listPath=path.join(dir,'list.json');
    await fs.writeFile(listPath,JSON.stringify(records));
    const remote=records.map(game=>({...game,pagesUrl:'https://webrpg.org/upstream/'}));
    await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./sync-upstream-list.mjs',import.meta.url))],{env:{...process.env,LIST_PATH:listPath,UPSTREAM_LIST_URL:`data:application/json,${encodeURIComponent(JSON.stringify(remote))}`}});
    const result=JSON.parse(await fs.readFile(listPath,'utf8'));
    assert.equal(result[0].status,'verified');assert.equal(result[0].pagesUrl,records[0].pagesUrl);assert.equal(result[0].entryPath,'Nested/index.html');
    assert.equal(result[1].status,'indexed');assert.equal(result[1].pagesUrl,undefined);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});

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
