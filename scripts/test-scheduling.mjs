import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {notifyPortal} from './notify-portal.mjs';

test('calendar cadence has no consecutive daily or duplicate scheduled runs', async()=>{
  const index=await fs.readFile('.github/workflows/index-github-rpgmaker-repos.yml','utf8');
  const cron=index.match(/cron: "([^"]+)"/)[1];
  assert.equal(cron,'17 2 1,6,11,16,21,26 * *');
  const days=new Set(cron.split(' ')[2].split(',').map(Number));
  let last=null,events=0;const intervals=new Set();
  for(let date=new Date('2026-01-01T02:17:00Z');date<new Date('2041-01-01T02:17:00Z');date=new Date(+date+86400000)){
    if(!days.has(date.getUTCDate()))continue;
    if(last){const gap=(date-last)/86400000;intervals.add(gap);assert.ok(gap>=3&&gap<=6,`unexpected gap ${gap}`)}
    last=date;events++;
  }
  assert.equal(events,15*12*6);assert.deepEqual([...intervals].sort(),[3,4,5,6]);
});

test('portal notification uses dispatch and reports rejection rather than overwriting catalog', async()=>{
  const result=await notifyPortal({repository:'owner/owner.github.io',token:'test-fixture',request:async(url,options)=>{
    assert.ok(url.endsWith('/dispatches'));assert.equal(options.method,'POST');
    assert.deepEqual(JSON.parse(options.body),{event_type:'catalog-updated'});return {status:204};
  }});
  assert.deepEqual(result,{notified:true});
  await assert.rejects(notifyPortal({repository:'owner/owner.github.io',token:'test-fixture',request:async()=>({status:404})}),/HTTP 404/);
});
