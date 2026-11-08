import fs from 'node:fs/promises';
import {publishCatalog} from './generated-file-publisher-lib.mjs';
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !repository) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
const base = JSON.parse(await fs.readFile('.catalog-base.json','utf8'));
const generated = JSON.parse(await fs.readFile('list.json','utf8'));
const url = `https://api.github.com/repos/${repository}/contents/list.json`;
const headers = {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json'};
const result = await publishCatalog({base,generated,
  read:async()=>{
    const response=await fetch(url+'?ref=main',{headers,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Read canonical catalog HTTP ${response.status}`);
    const data=await response.json();
    let content=data.content;
    if(data.encoding!=='base64'){
      const blob=await fetch(data.git_url,{headers,signal:AbortSignal.timeout(30000)});
      if(!blob.ok)throw new Error(`Read catalog blob HTTP ${blob.status}`);
      content=(await blob.json()).content;
    }
    return {sha:data.sha,content:JSON.parse(Buffer.from(content,'base64').toString('utf8'))};
  },
  write:async(content,sha)=>{
    const response=await fetch(url,{method:'PUT',headers,signal:AbortSignal.timeout(30000),body:JSON.stringify({branch:'main',sha,message:'Update canonical catalog metadata',content:Buffer.from(JSON.stringify(content,null,2)+'\n').toString('base64')})});
    return response.status;
  }
});
console.log(JSON.stringify(result));
