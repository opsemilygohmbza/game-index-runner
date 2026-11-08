import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);

export function parseLfsPointer(text) {
  const match = String(text).match(/^version https:\/\/git-lfs.github.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize (\d+)\s*$/);
  if (!match) return null;
  const size = Number(match[2]);
  return Number.isSafeInteger(size) && size >= 0 ? {oid:match[1],size} : null;
}

export async function readVerifiedLfsObject(response, pointer) {
  if (!response.ok) throw new Error(`LFS resource HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== pointer.size) throw new Error('LFS length mismatch');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > pointer.size) throw new Error('LFS resource exceeded declared size');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  if (length !== pointer.size || crypto.createHash('sha256').update(body).digest('hex') !== pointer.oid) {
    throw new Error('LFS integrity mismatch');
  }
  return body;
}

// Download only hash-verified objects from this owned fork. No Git LFS
// installation, runtime URL rewriting, or token written to repository/config.
export async function materializeLfsAssets({repository,token,maxBytes=900*1024*1024,request=fetch}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)||!token) throw new Error('Owned repository and token required');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rpg-lfs-'));
  const checkout=path.join(dir,'game');
  const env={...process.env,GIT_LFS_SKIP_SMUDGE:'1',GIT_TERMINAL_PROMPT:'0',
    GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_0:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    GIT_CONFIG_KEY_1:'filter.lfs.process',GIT_CONFIG_VALUE_1:'',GIT_CONFIG_KEY_2:'filter.lfs.smudge',GIT_CONFIG_VALUE_2:'',GIT_CONFIG_KEY_3:'filter.lfs.required',GIT_CONFIG_VALUE_3:'false',
    GIT_AUTHOR_NAME:'RPG Publisher',GIT_AUTHOR_EMAIL:`${repository.split('/')[0]}@users.noreply.github.com`,GIT_COMMITTER_NAME:'RPG Publisher',GIT_COMMITTER_EMAIL:`${repository.split('/')[0]}@users.noreply.github.com`};
  const git=async(args,cwd=checkout)=>{
    try{return await exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env,maxBuffer:32*1024*1024,timeout:600000})}
    catch(error){throw new Error(`Git operation failed (${args[0]}): ${String(error.stderr||error.message).replace(/AUTHORIZATION:[^\n]*/gi,'[redacted]')}`)}
  };
  try {
    await git(['clone','--depth','1',`https://github.com/${repository}.git`,checkout],dir);
    const sha=(await git(['rev-parse','HEAD'])).stdout.trim();
    const files=(await git(['ls-files','-z'])).stdout.split('\0').filter(Boolean);
    const pointers=[];let bytes=0;let regularBytes=0;
    for(const file of files){
      const full=path.resolve(checkout,file);
      if(!full.startsWith(checkout+path.sep))throw new Error('Invalid repository path');
      const stat=await fs.lstat(full);
      if(!stat.isFile()) throw new Error(`Unsupported symbolic link or special file: ${file}`);
      regularBytes+=stat.size;
      if(stat.size>1024)continue;
      const pointer=parseLfsPointer(await fs.readFile(full,'utf8'));
      if(!pointer)continue;
      regularBytes-=stat.size;
      if(pointer.size>95*1024*1024)throw new Error(`LFS object exceeds regular Git file limit: ${file}`);
      bytes+=pointer.size;if(bytes>maxBytes)throw new Error('LFS resources exceed the Pages materialization budget; alternate hosting required');
      pointers.push({file,full,...pointer});
    }
    if(bytes+regularBytes>maxBytes)throw new Error('Static game exceeds the Pages publication budget');
    if(!pointers.length)return {files:0,bytes:0,changed:false};
    let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{
      while(cursor<pointers.length){
        const item=pointers[cursor++];
        const url=`https://media.githubusercontent.com/media/${repository}/${sha}/${item.file.split('/').map(encodeURIComponent).join('/')}`;
        const response=await request(url,{redirect:'error',signal:AbortSignal.timeout(90000)});
        let body;
        try {body=await readVerifiedLfsObject(response,item)}
        catch(error){throw new Error(`${error.message}: ${item.file}`)}
        await fs.writeFile(item.full,body);
      }
    }));
    // Mechanical migration: keep all attribution files and disable LFS filters
    // so the newly materialized content is committed as actual static bytes.
    for(const file of files.filter(file=>path.basename(file)==='.gitattributes')){
      const full=path.join(checkout,file);const text=await fs.readFile(full,'utf8');
      await fs.writeFile(full,text.split('\n').filter(line=>!/(?:^|\s)filter=lfs(?:\s|$)/.test(line)).join('\n'));
    }
    await fs.writeFile(path.join(checkout,'.nojekyll'),'');
    await fs.rm(path.join(checkout,'CNAME'),{force:true});
    await git(['-c','filter.lfs.clean=','add','--all']);
    await git(['commit','-m','Publish actual LFS assets for static game hosting']);
    await git(['push','origin','HEAD']);
    return {files:pointers.length,bytes,changed:true};
  } finally {await fs.rm(dir,{recursive:true,force:true})}
}
