import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {planFullMigration,migrationFinished} from './full-migration-plan.mjs';
import {publishCatalog} from './generated-file-publisher-lib.mjs';
import {checkPagesEntry} from './check-pages-entry.mjs';

const exec=promisify(execFile);
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target=process.env.TARGET_ORG||'opsemilygohmbza';
const repository=`${target}/game-index-runner`;
const portal=`${target}/${target}.github.io`;
const dryRun=process.env.DRY_RUN!=='false';
const stateDir=path.join(root,'migration-state');
const resultsDir=path.join(stateDir,'results');
const stateFile=path.join(stateDir,'progress.json');
const lockDir=path.join(stateDir,'lock');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let token=process.env.GITHUB_TOKEN||process.env.WEBRPG_APP_TOKEN||'';
if(!token && !dryRun)token=(await exec('gh',['auth','token'],{maxBuffer:16384})).stdout.trim();
let lastMutation=0;let lastFork=0;

async function api(endpoint,{method='GET',body,ok=[200]}={}) {
  if(method!=='GET')await delay(Math.max(0,1100-(Date.now()-lastMutation)));
  const response=await fetch(`https://api.github.com${endpoint}`,{method,
    headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  if(method!=='GET')lastMutation=Date.now();
  const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=null}
  if(ok.includes(response.status))return data;
  const error=new Error(`GitHub HTTP ${response.status}: ${data?.message||response.statusText}`);
  error.status=response.status;
  error.pause=[401,403,429].includes(response.status);
  error.retryAfter=response.headers.get('retry-after');
  error.resetAt=response.headers.get('x-ratelimit-reset');
  throw error;
}

async function readCatalog(){
  const data=await api(`/repos/${repository}/contents/list.json?ref=main`);
  const content=data.encoding==='base64'?data.content:(await api(`/repos/${repository}/git/blobs/${data.sha}`)).content;
  return{sha:data.sha,content:JSON.parse(Buffer.from(content,'base64').toString('utf8'))};
}
async function publish(base,generated){
  return publishCatalog({base,generated,read:readCatalog,write:async(content,sha)=>{
    try{
      await api(`/repos/${repository}/contents/list.json`,{method:'PUT',ok:[200,201],body:{branch:'main',sha,
        message:'Publish migration results to canonical catalog',content:Buffer.from(JSON.stringify(content,null,2)+'\n').toString('base64')}});
      return 200;
    }catch(error){if([409,422].includes(error.status))return error.status;throw error}
  }});
}
async function save(state){
  state.updatedAt=new Date().toISOString();
  await fs.writeFile(`${stateFile}.tmp`,JSON.stringify(state,null,2)+'\n',{mode:0o600});
  await fs.rename(`${stateFile}.tmp`,stateFile);
}
async function ensureFork(item){
  let owned=await api(`/repos/${target}/${item.forkName}`,{ok:[200,404]});
  if(owned?.id){
    const sources=[owned.parent?.full_name,owned.source?.full_name].filter(Boolean).map(value=>value.toLowerCase());
    if(!owned.fork||!sources.includes(item.source.toLowerCase()))throw new Error('Destination name belongs to a different repository; preserved without changes');
    return owned;
  }
  await delay(Math.max(0,8000-(Date.now()-lastFork)));
  owned=await api(`/repos/${item.source}/forks`,{method:'POST',ok:[202],body:{name:item.forkName,default_branch_only:true}});
  lastFork=Date.now();
  for(let attempt=0;attempt<6;attempt++){
    await delay(5000);
    const ready=await api(`/repos/${target}/${item.forkName}`,{ok:[200,404]});
    if(ready?.default_branch&&ready.size>=0)return ready;
  }
  throw new Error('Fork initialization is still pending; resume later');
}
async function prepare(item){
  const child=await exec(process.execPath,[path.join(root,'scripts/process-fork-repo.mjs')],{cwd:root,
    env:{...process.env,WEBRPG_APP_TOKEN:token,TARGET_ORG:target,REPO_NAME:item.forkName,DRY_RUN:'false',
      DELETE_INVALID_REPOS:'false',SITE_ORIGIN:'https://yx.ecy.al',RESULT_DIR:resultsDir,HTML_FETCH_CONCURRENCY:'1'},
    timeout:20*60*1000,maxBuffer:2*1024*1024});
  const result=JSON.parse(await fs.readFile(path.join(resultsDir,`${item.forkName}.json`),'utf8'));
  console.log(child.stdout.trim());
  if(result.status==='check_error'){
    const error=new Error(result.error||'Preparation failed');
    error.pause=/GitHub API (401|403|429)|rate limit|secondary rate/i.test(error.message);throw error;
  }
  return result;
}
async function verifyPages(item,result){
  const ref=await api(`/repos/${target}/${item.forkName}/git/ref/heads/${encodeURIComponent(result.defaultBranch)}`);
  for(let attempt=0;attempt<20;attempt++){
    const latest=await api(`/repos/${target}/${item.forkName}/pages/builds/latest`,{ok:[200,404]});
    if(latest?.commit===ref.object.sha && latest?.status==='built'){
      const entry=await checkPagesEntry(result.pagesUrl);
      return {commit:ref.object.sha,checkedAt:new Date().toISOString(),entryType:entry.type,check:'Pages built + HTML entry, not a full browser playthrough'};
    }
    if(latest?.commit===ref.object.sha&&latest?.status==='errored')throw new Error(`Pages build failed: ${latest.error?.message||'unknown error'}`);
    await delay(15000);
  }
  throw new Error('Pages build or entry is not ready after five minutes; resume will retry');
}

const local=JSON.parse(await fs.readFile(path.join(root,'list.json'),'utf8'));
if(dryRun){
  const plan=planFullMigration(local,target);
  console.log(JSON.stringify({dryRun:true,total:plan.length,pending:plan.filter(item=>!item.skip).length,skipped:plan.filter(item=>item.skip).length},null,2));
}else{
  const identity=await api('/user');
  if(identity.login.toLowerCase()!==target.toLowerCase())throw new Error(`Signed-in account does not match ${target}`);
  await fs.mkdir(resultsDir,{recursive:true,mode:0o700});
  try{await fs.mkdir(lockDir)}catch{throw new Error('Another full migration owns the lock; inspect its process before resuming')}
  let state;
  try{
    state=JSON.parse(await fs.readFile(stateFile,'utf8').catch(error=>error.code==='ENOENT'?'{}':Promise.reject(error)));
    if(state.target && state.target!==target)throw new Error('Migration checkpoint account mismatch');
    state={...state,target,startedAt:state.startedAt||new Date().toISOString(),items:state.items||{},phase:'running'};
    const {content:entries}=await readCatalog();
    const plan=planFullMigration(entries,target);state.total=plan.length;
    if(process.env.RETRY_BLOCKED==='true')for(const item of Object.values(state.items))if(item.phase==='blocked')item.phase='retry';
    await save(state);
    let changedSinceDeploy=state.pendingPortalUpdates||0;
    for(const item of plan){
      if(migrationFinished(state.items[item.id]))continue;
      if(item.skip){state.items[item.id]={phase:item.skip,source:item.source};await save(state);continue}
      const entry={phase:'forking',source:item.source,forkName:item.forkName,startedAt:new Date().toISOString()};
      state.items[item.id]=entry;await save(state);
      console.log(`[queue] ${Object.values(state.items).filter(migrationFinished).length}/${plan.length} ${item.source}`);
      try{
        await ensureFork(item);entry.phase='preparing';await save(state);
        const result=await prepare(item);
        if(result.status==='invalid_structure'){
          entry.phase='invalid_structure';entry.error=result.invalidReason;await save(state);continue;
        }
        if(result.status!=='verified'||!result.pagesEnabled)throw new Error(`Unexpected preparation status: ${result.status}`);
        entry.phase='publishing';await save(state);
        const publication=await verifyPages(item,result);
        const current=await readCatalog();
        const generated=current.content.map(game=>game.id!==item.id?game:{...game,status:'verified',checkedAt:result.checkedAt,
          forkName:item.forkName,pagesUrl:result.pagesUrl,entryPath:result.entryPath,engine:result.engine,
          cover:result.cover||null,totalSize:result.totalSize,dataSize:result.dataSize,validationScore:result.validationScore,
          publication,runtime:game.publication?.commit===publication.commit?game.runtime:undefined,lastCheckError:undefined});
        const saved=await publish(current.content,generated);
        if(saved.changed)changedSinceDeploy++;
        state.pendingPortalUpdates=changedSinceDeploy;
        entry.phase='published';entry.publication=publication;await save(state);
        console.log(`[published] ${item.id} ${result.pagesUrl}`);
        if(changedSinceDeploy>=10){
          await api(`/repos/${portal}/actions/workflows/deploy-pages.yml/dispatches`,{method:'POST',ok:[204],body:{ref:'main'}});
          changedSinceDeploy=0;
          state.pendingPortalUpdates=0;await save(state);
        }
      }catch(error){
        entry.phase=error.pause?'paused':'blocked';entry.error=error.message;entry.checkedAt=new Date().toISOString();
        await save(state);console.log(`[${entry.phase}] ${item.source}: ${error.message}`);
        if(error.pause){state.phase='paused';state.pauseReason=error.message;await save(state);throw error}
      }
    }
    if(changedSinceDeploy)await api(`/repos/${portal}/actions/workflows/deploy-pages.yml/dispatches`,{method:'POST',ok:[204],body:{ref:'main'}});
    state.pendingPortalUpdates=0;state.phase='finished-with-results';await save(state);
    console.log(JSON.stringify({phase:state.phase,counts:Object.values(state.items).reduce((counts,item)=>(counts[item.phase]=(counts[item.phase]||0)+1,counts),{})}));
  }finally{await fs.rmdir(lockDir)}
}
