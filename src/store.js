// Where settings live.
//
// Locally that's config.json on disk. On Vercel the filesystem is read-only, so
// settings are read from — and written back to — the GitHub repo through the
// contents API. The repo stays the single source of truth either way, which
// also means every settings change gets a commit and can be rolled back.
//
//   GITHUB_REPO   "owner/name"  enables GitHub-backed storage
//   GITHUB_TOKEN  a fine-grained PAT with Contents: read & write
//   GITHUB_BRANCH defaults to "main"

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED = join(__dirname, '..', 'config.json');
const LOCAL_PATH = process.env.CONFIG_PATH || BUNDLED;

const REPO = (process.env.GITHUB_REPO || '').trim();
const TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const BRANCH = (process.env.GITHUB_BRANCH || 'main').trim();
const FILE = (process.env.GITHUB_CONFIG_PATH || 'config.json').trim();
const ON_VERCEL = Boolean(process.env.VERCEL);

// 'github'  settings read/written through the GitHub API
// 'file'    settings read/written on the local disk
// 'readonly' deployed without a token — the feed works, saving does not
export function storageMode() {
  if (REPO && TOKEN) return 'github';
  if (ON_VERCEL) return 'readonly';
  return 'file';
}

export function canSave() {
  return storageMode() !== 'readonly';
}

const api = (path) => `https://api.github.com/repos/${REPO}/contents/${path}`;
const ghHeaders = () => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'prayer-calendar',
});

// Serverless functions are short-lived but can serve several requests; a short
// cache keeps a burst of calendar fetches from hammering the GitHub API.
let cache = { at: 0, value: null };
const TTL_MS = 30_000;

function readBundled() {
  const path = existsSync(LOCAL_PATH) ? LOCAL_PATH : BUNDLED;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export async function readConfig({ fresh = false } = {}) {
  if (storageMode() !== 'github') return readBundled();

  if (!fresh && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;

  try {
    const res = await fetch(`${api(FILE)}?ref=${encodeURIComponent(BRANCH)}`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
    const body = await res.json();
    const value = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // Never let a GitHub hiccup take the calendar feed down — fall back to the
    // copy baked into the deployment, which is the last committed state anyway.
    console.error('[store] falling back to bundled config:', err.message);
    return cache.value || readBundled();
  }
}

export async function writeConfig(config) {
  const mode = storageMode();

  if (mode === 'readonly') {
    throw new Error(
      'This deployment has no write access, so settings cannot be saved here. ' +
      'Add GITHUB_REPO and GITHUB_TOKEN environment variables to enable editing.'
    );
  }

  const json = JSON.stringify(config, null, 2) + '\n';

  if (mode === 'file') {
    const tmp = LOCAL_PATH + '.tmp';
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, LOCAL_PATH); // atomic-ish: never leaves a half-written config
    return { mode };
  }

  // Need the current blob SHA to replace the file.
  let sha;
  const head = await fetch(`${api(FILE)}?ref=${encodeURIComponent(BRANCH)}`, { headers: ghHeaders() });
  if (head.ok) sha = (await head.json()).sha;
  else if (head.status !== 404) throw new Error(`GitHub read failed: ${head.status}`);

  const res = await fetch(api(FILE), {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Update prayer settings',
      content: Buffer.from(json, 'utf8').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error('GitHub rejected the token. Check it has Contents: read & write on this repo and has not expired.');
    }
    throw new Error(`GitHub write failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  cache = { at: Date.now(), value: config };
  return { mode, commit: (await res.json()).commit?.sha };
}
