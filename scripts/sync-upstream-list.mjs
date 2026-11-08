import fs from "node:fs/promises";
import { normalizeCatalog, isOwnPagesUrl } from './catalog-normalization.mjs';

const upstreamUrl = process.env.UPSTREAM_LIST_URL || "https://raw.githubusercontent.com/WebRPG-org/index/main/list.json";
const listPath = process.env.LIST_PATH || "list.json";
const local = normalizeCatalog(JSON.parse(await fs.readFile(listPath, "utf8")));
const response = await fetch(upstreamUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });

if (!response.ok) {
  throw new Error(`Upstream returned ${response.status}.`);
}

const upstream = await response.json();
if (!Array.isArray(local) || !Array.isArray(upstream)) {
  throw new Error("Both catalogs must be JSON arrays.");
}

const localByKey = new Map(local.map((entry) => [key(entry), entry]));
const merged = normalizeCatalog(upstream).map((remote) => mergeUpstream(remote, localByKey.get(key(remote))));
const upstreamKeys = new Set(upstream.map(key));

// Keep discoveries made by this index even when they have not yet appeared in
// the upstream catalog. Upstream remains authoritative for shared entries.
for (const entry of local) {
  if (!upstreamKeys.has(key(entry))) {
    merged.push(entry);
  }
}

merged.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans") || key(a).localeCompare(key(b), "en"));
const normalized = normalizeCatalog(merged);
await fs.writeFile(listPath, `${JSON.stringify(normalized, null, 2)}\n`);

console.log(JSON.stringify({ upstream: upstream.length, localBefore: local.length, localAfter: merged.length, upstreamOnly: upstream.filter((entry) => !localByKey.has(key(entry))).length }, null, 2));

function mergeUpstream(remote, localEntry) {
  const entry = { ...remote, ...localEntry, title: remote.title || localEntry?.title, source: localEntry?.source || remote.source || "upstream-webrpg-index" };
  const upstreamPagesUrl = remote.pagesUrl;
  const upstreamCover = remote.cover;

  // Upstream Pages and covers belong to a different publisher. Never carry
  // those URLs into this organization’s playable catalog.
  delete entry.pagesUrl;
  delete entry.cover;
  delete entry.lastCheckError;
  entry.status = "indexed";

  if (upstreamPagesUrl) entry.upstreamPagesUrl = upstreamPagesUrl;
  if (upstreamCover) entry.upstreamCover = upstreamCover;
  if (remote.status) entry.upstreamStatus = remote.status;

  if (!localEntry) return clean(entry);

  const localPagesUrl = localEntry.pagesUrl;
  if (isOwnPagesUrl(localPagesUrl)) {
    entry.pagesUrl = localPagesUrl;
    entry.cover = localEntry.cover;
    entry.status = localEntry.status || "verified";
    entry.checkedAt = localEntry.checkedAt;
    entry.entryPath = localEntry.entryPath;
    entry.coverPath = localEntry.coverPath;
    entry.validationScore = localEntry.validationScore;
    entry.totalSize = localEntry.totalSize;
    entry.dataSize = localEntry.dataSize;
  } else if (["invalid_structure", "check_error", "hidden"].includes(localEntry.status)) {
    entry.status = localEntry.status;
    entry.checkedAt = localEntry.checkedAt;
    entry.invalidReason = localEntry.invalidReason;
    entry.lastCheckError = localEntry.lastCheckError;
  }

  if (localEntry.forkName) entry.forkName = localEntry.forkName;
  return clean(entry);
}

function key(entry) {
  return `${entry.owner || ""}/${entry.name || ""}`.toLowerCase();
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}
