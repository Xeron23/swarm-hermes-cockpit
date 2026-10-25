import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateBuildInfo(info, version, env) {
  if (info.version !== version) throw new Error('Frontend bundle version differs from package.json');
  if (env.GITHUB_SHA && info.commit !== env.GITHUB_SHA) throw new Error('Frontend bundle belongs to another source commit');
  if (env.GITHUB_RUN_NUMBER && info.run !== env.GITHUB_RUN_NUMBER) throw new Error('Frontend bundle belongs to another build run');
  if (env.GITHUB_RUN_ATTEMPT && info.attempt !== env.GITHUB_RUN_ATTEMPT) throw new Error('Frontend bundle belongs to another build attempt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = JSON.parse(readFileSync('dist/build-info.json', 'utf8'));
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  validateBuildInfo(info, version, process.env);
  console.log(`Verified frontend bundle: ${info.version}, commit ${info.commit}, build ${info.run || 'local'}`);
}
