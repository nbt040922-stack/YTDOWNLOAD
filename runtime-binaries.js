const fs = require('fs');
const path = require('path');

const ENGINE_SPECS = Object.freeze({
  ytdlp: { file: 'yt-dlp.exe', args: ['--version'], versionPattern: /\S/ },
  deno: { file: 'deno.exe', args: ['--version'], versionPattern: /^deno\s/i },
  ffmpeg: { file: 'ffmpeg.exe', args: ['-version'], versionPattern: /^ffmpeg version\s/i }
});

function firstVersion(result, pattern) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.split(/\r?\n/).find(line => pattern.test(line)) || null;
}

async function probeBinary(filePath, spec, { run, env = process.env, fileSystem = fs }) {
  if (!fileSystem.existsSync(filePath)) return { status: 'missing', version: null, result: null };
  const result = await run(filePath, spec.args, { env });
  return {
    status: result.ok ? 'ok' : 'cannot_run',
    version: result.ok ? firstVersion(result, spec.versionPattern) : null,
    result
  };
}

async function recoverRuntimeBinary(name, paths, options) {
  const spec = ENGINE_SPECS[name];
  const runtimePath = paths[`${name}Path`];
  const fallbackPath = paths[`fallback${name[0].toUpperCase()}${name.slice(1)}Path`];
  const candidates = [];
  if (name === 'ytdlp') candidates.push({
    source: 'backup',
    path: paths.ytdlpBackupPath || path.join(path.dirname(runtimePath), 'yt-dlp.backup.exe')
  });
  candidates.push({ source: 'fallback', path: fallbackPath });

  const current = await probeBinary(runtimePath, spec, options);
  if (current.status === 'ok') return { ok: true, source: 'runtime', version: current.version };

  for (const candidate of candidates) {
    if (!candidate.path) continue;
    const probe = await probeBinary(candidate.path, spec, options);
    if (probe.status !== 'ok') continue;
    try {
      options.fileSystem.mkdirSync(path.dirname(runtimePath), { recursive: true });
      options.fileSystem.copyFileSync(candidate.path, runtimePath);
    } catch (_) {
      continue;
    }
    const restored = await probeBinary(runtimePath, spec, options);
    if (restored.status === 'ok') return { ok: true, source: candidate.source, version: restored.version };
  }
  return { ok: false, source: null, version: null };
}

async function bootstrapRuntime(paths, {
  run,
  env = process.env,
  fileSystem = fs,
  now = () => new Date().toISOString()
}) {
  fileSystem.mkdirSync(paths.runtimeDir, { recursive: true });
  const engines = {};
  for (const [name, spec] of Object.entries(ENGINE_SPECS)) {
    const fallbackPath = paths[`fallback${name[0].toUpperCase()}${name.slice(1)}Path`];
    const fallback = await probeBinary(fallbackPath, spec, { run, env, fileSystem });
    const recovery = await recoverRuntimeBinary(name, paths, { run, env, fileSystem });
    engines[name] = {
      runtime_status: recovery.ok ? 'ok' : 'cannot_run',
      runtime_version: recovery.version,
      fallback_status: fallback.status,
      fallback_version: fallback.version,
      recovery_source: recovery.source
    };
  }
  const state = {
    bootstrapped_at: now(),
    ok: Object.values(engines).every(engine => engine.runtime_status === 'ok' && engine.fallback_status === 'ok'),
    engines,
    persistence_status: 'ok'
  };
  try {
    const tempPath = `${paths.bootstrapStatePath}.tmp`;
    fileSystem.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fileSystem.renameSync(tempPath, paths.bootstrapStatePath);
  } catch (_) {
    state.persistence_status = 'failed';
  }
  paths.recoverySources = Object.fromEntries(Object.entries(engines).map(([name, engine]) => [name, engine.recovery_source]));
  return state;
}

module.exports = { ENGINE_SPECS, bootstrapRuntime, probeBinary, recoverRuntimeBinary };
