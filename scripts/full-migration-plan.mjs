import crypto from 'node:crypto';

export function makeForkName(owner,name) {
  const raw=`${owner}-${name}`;
  let safe=raw.replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[.-]+|[.-]+$/g,'');
  if (!safe) safe=`repo-${crypto.createHash('sha1').update(raw).digest('hex').slice(0,8)}`;
  return safe.length<=100?safe:`${safe.slice(0,91).replace(/[.-]+$/g,'')}-${crypto.createHash('sha1').update(raw).digest('hex').slice(0,8)}`;
}

export function planFullMigration(entries,target) {
  const sources=new Map();const names=new Map();
  for (const entry of entries) {
    if (!/^[A-Za-z0-9_.-]+$/.test(entry.owner||'') || !/^[A-Za-z0-9_.-]+$/.test(entry.name||'')) throw new Error('Invalid catalog repository identity');
    const source=`${entry.owner}/${entry.name}`;
    if (sources.has(source.toLowerCase())) continue;
    let forkName=makeForkName(entry.owner,entry.name);
    const used=names.get(forkName.toLowerCase());
    if (used && used!==source.toLowerCase()) forkName=makeForkName(entry.owner,`${entry.name}-${crypto.createHash('sha1').update(source).digest('hex').slice(0,8)}`);
    names.set(forkName.toLowerCase(),source.toLowerCase());
    sources.set(source.toLowerCase(),{id:entry.id,source,forkName,
      skip:entry.status==='hidden'?'hidden':entry.owner.toLowerCase()===target.toLowerCase()?'already-owned':
        ['invalid_structure','deleted_invalid_structure','duplicate_name'].includes(entry.status)?'invalid_structure':null,
      priority:entry.runtime?.status==='passed'?0:entry.upstreamStatus==='verified'?1:2,
      chinese:/[\u3400-\u9fff]/.test(entry.title||'')});
  }
  return [...sources.values()].sort((a,b)=>a.priority-b.priority||Number(b.chinese)-Number(a.chinese)||a.source.localeCompare(b.source));
}

export function migrationFinished(state) {
  return ['published','invalid_structure','blocked','hidden','already-owned'].includes(state?.phase);
}
