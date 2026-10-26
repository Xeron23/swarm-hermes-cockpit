import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { releaseMetadata } from './release.mjs';
import { validateUpdateFeed } from './update-feed.mjs';

export async function verifyPublicRelease({ repository, metadata, latest = false, fetcher = fetch,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 6 } = {}) {
  const urls = [`https://github.com/${repository}/releases/download/${encodeURIComponent(metadata.tag)}/latest.json`];
  if (latest) urls.push(`https://github.com/${repository}/releases/latest/download/latest.json`);
  for (const url of urls) {
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetcher(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Public update feed returned HTTP ${response.status}`);
        validateUpdateFeed(await response.json(), { repository, metadata });
        last = null; break;
      } catch (error) { last = error; if (attempt + 1 < attempts) await pause(2000); }
    }
    if (last) throw last;
  }
  return { urls };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const result = await verifyPublicRelease({ repository: process.env.GITHUB_REPOSITORY,
    metadata: releaseMetadata(process.env, version), latest: process.env.HERMES_VERIFY_LATEST === 'true' });
  console.log(`PASS: anonymous signed update manifest for ${result.urls.length} release endpoint(s)`);
}
