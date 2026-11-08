import { pathToFileURL } from 'node:url';

export async function notifyPortal({repository, token, request = fetch}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !token) throw new Error('Portal repository and token are required');
  const response = await request(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'},
    body: JSON.stringify({event_type: 'catalog-updated'}),
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 204) throw new Error(`Portal notification HTTP ${response.status}; catalog is saved, retry portal deployment manually`);
  return {notified: true};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await notifyPortal({repository: process.env.PORTAL_REPOSITORY, token: process.env.PORTAL_TOKEN})));
}
