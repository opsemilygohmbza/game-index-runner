import path from 'node:path';

export function enabledPluginPaths(text) {
  const assignment = String(text).match(/(?:var|let|const)\s+\$plugins\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
  if (!assignment) throw new Error('plugins.js has an unsupported configuration format');
  const plugins = JSON.parse(assignment[1]);
  if (!Array.isArray(plugins)) throw new Error('plugins.js must contain an array');
  return plugins.filter(plugin => plugin.status === true).map(plugin => {
    if (typeof plugin.name !== 'string' || !plugin.name || /[\\/\x00-\x1f]/.test(plugin.name)) {
      throw new Error('Invalid enabled plugin name');
    }
    return `js/plugins/${plugin.name}.js`;
  });
}

export function assertStartupFiles(files, html, entryPath, pluginText, projectRoot='',mainText='') {
  const paths = new Set(files.map(file => file.path));
  const required = [`${projectRoot}data/System.json`, `${projectRoot}js/plugins.js`];
  const script = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;
  for (const match of String(html).matchAll(script)) {
    const src = match[1].trim().split(/[?#]/)[0];
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    if (src.startsWith('/')) throw new Error(`Root-absolute startup script is not portable: ${src}`);
    let decoded;
    try { decoded=decodeURIComponent(src); } catch { throw new Error(`Invalid script path: ${src}`); }
    required.push(path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), decoded)));
  }
  required.push(...enabledPluginPaths(pluginText).map(file => `${projectRoot}${file}`));
  const dynamic=String(mainText).match(/(?:const|let|var)\s+scriptUrls\s*=\s*(\[[\s\S]*?\])\s*;/);
  if(dynamic){
    const urls=JSON.parse(dynamic[1]);
    if(!Array.isArray(urls)||urls.some(url=>typeof url!=='string'||/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(url)||url.includes('..')))throw new Error('Unsupported dynamic startup script list');
    required.push(...urls.map(url=>`${projectRoot}${url}`));
  }
  const wasm=String(mainText).match(/effekseerWasmUrl\s*=\s*["']([^"']+)["']/);
  if(wasm)required.push(`${projectRoot}${wasm[1]}`);
  const missing = [...new Set(required)].filter(file => !paths.has(file));
  if (missing.length) throw new Error(`Missing startup files (case-sensitive): ${missing.slice(0,12).join(', ')}`);
  return required.length;
}
