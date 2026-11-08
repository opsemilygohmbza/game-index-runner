export function dynamicMainUrl(html,entryUrl) {
  for(const match of String(html).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)){
    const value=match[1].trim();
    if(!/(?:^|\/)js\/main\.js(?:[?#]|$)/i.test(value) && value!=='js/main.js')continue;
    const url=new URL(value,entryUrl);
    if(url.origin!==new URL(entryUrl).origin)continue;
    return url;
  }
  return null;
}

export async function checkPagesEntry(entryUrl,request=fetch) {
  const response=await request(entryUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
  const html=await response.text();
  if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')||''))throw new Error(`Game entry HTTP ${response.status} is not HTML`);
  if(/rpg_core\.js|rmmz_core\.js/i.test(html))return{type:'direct-core'};
  const main=dynamicMainUrl(html,entryUrl);
  if(!main)throw new Error('Game entry does not reference RPG Maker runtime or main.js');
  const script=await request(main,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!script.ok||!/rpg_core\.js|rmmz_core\.js/i.test(await script.text()))throw new Error('main.js does not load an RPG Maker core');
  return{type:'dynamic-main'};
}
