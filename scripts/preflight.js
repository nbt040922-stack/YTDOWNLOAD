const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REQUIRED_APP_FILES = [
  'package.json', 'main.js', 'preload.js', 'renderer.js', 'index.html', 'style.css',
  'engine-runtime.js', 'runtime-binaries.js', 'download-manager.js', 'auth-session.js',
  path.join('resources', 'mascot.png')
];
const ENGINES = [
  { name: 'yt-dlp.exe', args: ['--version'] },
  { name: 'deno.exe', args: ['--version'] },
  { name: 'ffmpeg.exe', args: ['-version'] }
];

function runPreflight({ projectDir = path.resolve(__dirname, '..'), run = spawnSync } = {}) {
  const failures = [];
  for (const file of REQUIRED_APP_FILES) {
    if (!fs.existsSync(path.join(projectDir, file))) failures.push(`missing app resource: ${file}`);
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    if (!metadata.name || !metadata.version || metadata.main !== 'main.js') failures.push('invalid package metadata');
  } catch (error) {
    failures.push(`invalid package.json: ${error.message}`);
  }

  const fallbackDir = path.join(projectDir, 'resources', 'bin', 'fallback');
  const versions = {};
  for (const engine of ENGINES) {
    const executable = path.join(fallbackDir, engine.name);
    if (!fs.existsSync(executable)) {
      failures.push(`missing fallback binary: ${engine.name}`);
      continue;
    }
    const result = run(executable, engine.args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, PATH: '' }
    });
    if (result.error || result.status !== 0) {
      failures.push(`fallback binary cannot run: ${engine.name}`);
    } else {
      versions[engine.name] = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/)[0];
    }
  }

  const resources = metadata?.build?.extraResources || [];
  if (!resources.some(resource => resource.from === 'resources/bin/fallback/' && resource.to === 'bin/fallback/')) {
    failures.push('package config does not include immutable fallback binaries');
  }
  const files = metadata?.build?.files || [];
  if (!files.includes('!resources/bin{,/**/*}')) {
    failures.push('package config does not exclude source binaries from app.asar');
  }
  if (failures.length) throw new Error(`Build preflight failed:\n- ${failures.join('\n- ')}`);
  return { ok: true, fallbackDir, versions };
}

async function beforePack(context) {
  const result = runPreflight({ projectDir: context.packager.projectDir });
  console.log(`[preflight] fallback engines verified: ${Object.keys(result.versions).join(', ')}`);
}

module.exports = { default: beforePack, runPreflight };

if (require.main === module) {
  try {
    const result = runPreflight();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
