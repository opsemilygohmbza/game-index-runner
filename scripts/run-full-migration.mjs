import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cooldownUntil} from './rate-limit-backoff.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const progress=path.join(root,'migration-state/progress.json');
let retries=0;let lastItem='';
while(true){
  const checkpoint=JSON.parse(await fs.readFile(progress,'utf8').catch(error=>error.code==='ENOENT'?'{}':Promise.reject(error)));
  if(checkpoint.phase==='paused' && !lastItem){lastItem=checkpoint.pausedItem||'';retries=checkpoint.cooldownAttempt||0}
  if(checkpoint.phase==='paused'&&checkpoint.resumeNotBefore>Date.now()){
    console.log(`[cooldown] Waiting for the saved GitHub retry time ${new Date(checkpoint.resumeNotBefore).toISOString()}`);
    while(Date.now()<checkpoint.resumeNotBefore)await new Promise(resolve=>setTimeout(resolve,Math.min(60000,checkpoint.resumeNotBefore-Date.now())));
  }
  // Uses the same signed-in identity. Never switches accounts, proxies or keys
  // in response to a platform throttle.
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'scripts/migrate-all-games.mjs')],{cwd:root,env:process.env,stdio:'inherit'});
    child.once('error',reject);child.once('exit',(code,signal)=>signal?reject(new Error(`Migration terminated by ${signal}`)):resolve(code));
  });
  if(code===0)break;
  const state=JSON.parse(await fs.readFile(progress,'utf8'));
  const retryable=state.pauseRetryable ?? /submitted too quickly|secondary rate|rate limit exceeded/i.test(state.pauseReason||'');
  if(state.phase!=='paused'||!retryable)throw new Error('Migration needs attention; progress is preserved');
  const item=state.pausedItem||Object.entries(state.items).find(([,value])=>value.phase==='paused')?.[0];
  if(item!==lastItem){retries=0;lastItem=item}
  if(retries>=5)throw new Error('GitHub throttle persisted through five cooldowns; checkpoint preserved for operator review');
  const until=cooldownUntil(state,retries);
  state.resumeNotBefore=until;
  retries++;
  state.cooldownAttempt=retries;
  await fs.writeFile(progress+'.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});
  await fs.rename(progress+'.tmp',progress);
  console.log(`[cooldown] GitHub secondary throttle; retry ${retries}/5 no earlier than ${new Date(until).toISOString()}`);
  while(Date.now()<until)await new Promise(resolve=>setTimeout(resolve,Math.min(60000,until-Date.now())));
}
