const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildYtDlpBaseArgs, repairYtDlp, safeUpdateYtDlp } = require('../engine-runtime');
const { bootstrapRuntime } = require('../runtime-binaries');
const { runPreflight } = require('../scripts/preflight');

const tempDirs = [];
test.afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function setup({ fallback = true, runtime = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-phase5-'));
  tempDirs.push(root);
  const runtimeDir = path.join(root, 'runtime');
  const fallbackDir = path.join(root, 'fallback');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(fallbackDir, { recursive: true });
  const paths = {
    runtimeDir,
    fallbackDir,
    ytdlpPath: path.join(runtimeDir, 'yt-dlp.exe'),
    denoPath: path.join(runtimeDir, 'deno.exe'),
    ffmpegPath: path.join(runtimeDir, 'ffmpeg.exe'),
    ytdlpBackupPath: path.join(runtimeDir, 'yt-dlp.backup.exe'),
    fallbackYtdlpPath: path.join(fallbackDir, 'yt-dlp.exe'),
    fallbackDenoPath: path.join(fallbackDir, 'deno.exe'),
    fallbackFfmpegPath: path.join(fallbackDir, 'ffmpeg.exe'),
    bootstrapStatePath: path.join(runtimeDir, 'bootstrap-state.json')
  };
  if (fallback) writeSet(paths, 'fallback', 'valid-fallback');
  if (runtime) writeSet(paths, 'runtime', 'valid-runtime');
  return { paths, root };
}

function writeSet(paths, target, content) {
  for (const name of ['ytdlp', 'deno', 'ffmpeg']) {
    const key = target === 'runtime' ? `${name}Path` : `fallback${name[0].toUpperCase()}${name.slice(1)}Path`;
    fs.writeFileSync(paths[key], `${content}-${name}`);
  }
}

async function fakeRun(executable, args) {
  if (!path.isAbsolute(executable) || !fs.existsSync(executable)) return { ok: false, error: 'missing' };
  if (args[0] === '--update') {
    fs.writeFileSync(executable, 'valid-updated-ytdlp');
    return { ok: true, stdout: 'updated' };
  }
  const content = fs.readFileSync(executable, 'utf8');
  if (!content.startsWith('valid')) return { ok: false, error: 'corrupt' };
  if (path.basename(executable) === 'deno.exe') return { ok: true, stdout: `deno ${content}` };
  if (path.basename(executable) === 'ffmpeg.exe') return { ok: true, stdout: `ffmpeg version ${content}` };
  return { ok: true, stdout: content };
}

function diagnose(paths) {
  const status = filePath => !fs.existsSync(filePath) ? 'missing' : fs.readFileSync(filePath, 'utf8').startsWith('valid') ? 'ok' : 'cannot_run';
  return Promise.resolve({
    ytdlp_status: status(paths.ytdlpPath),
    deno_status: status(paths.denoPath),
    ffmpeg_status: status(paths.ffmpegPath),
    yt_dlp_version: status(paths.ytdlpPath) === 'ok' ? fs.readFileSync(paths.ytdlpPath, 'utf8') : null
  });
}

test('first-run bootstrap creates and verifies writable runtime', async () => {
  const { paths } = setup();
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(result.ok, true);
  assert.ok(['ytdlp', 'deno', 'ffmpeg'].every(name => result.engines[name].recovery_source === 'fallback'));
  assert.equal(fs.existsSync(paths.bootstrapStatePath), true);
  assert.equal(JSON.parse(fs.readFileSync(paths.bootstrapStatePath, 'utf8')).persistence_status, 'ok');
});

test('valid newer runtime is not overwritten by fallback', async () => {
  const { paths } = setup({ runtime: true });
  fs.writeFileSync(paths.ytdlpPath, 'valid-newer-runtime-ytdlp');
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(fs.readFileSync(paths.ytdlpPath, 'utf8'), 'valid-newer-runtime-ytdlp');
  assert.equal(result.engines.ytdlp.recovery_source, 'runtime');
});

test('missing runtime binary is restored from fallback', async () => {
  const { paths } = setup({ runtime: true });
  fs.unlinkSync(paths.ytdlpPath);
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(result.engines.ytdlp.recovery_source, 'fallback');
  assert.equal(await fakeRun(paths.ytdlpPath, ['--version']).then(value => value.ok), true);
});

test('corrupt runtime binary is restored', async () => {
  const { paths } = setup({ runtime: true });
  fs.writeFileSync(paths.ytdlpPath, 'corrupt');
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(result.engines.ytdlp.recovery_source, 'fallback');
  assert.match(fs.readFileSync(paths.ytdlpPath, 'utf8'), /^valid-fallback/);
});

test('valid backup is preferred before fallback', async () => {
  const { paths } = setup({ runtime: true });
  fs.writeFileSync(paths.ytdlpPath, 'corrupt');
  fs.writeFileSync(paths.ytdlpBackupPath, 'valid-backup-ytdlp');
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(result.engines.ytdlp.recovery_source, 'backup');
  assert.equal(fs.readFileSync(paths.ytdlpPath, 'utf8'), 'valid-backup-ytdlp');
});

test('invalid backup falls back to immutable copy', async () => {
  const { paths } = setup({ runtime: true });
  fs.writeFileSync(paths.ytdlpPath, 'corrupt-runtime');
  fs.writeFileSync(paths.ytdlpBackupPath, 'corrupt-backup');
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(result.engines.ytdlp.recovery_source, 'fallback');
});

test('yt-dlp update modifies writable runtime only', async () => {
  const { paths } = setup({ runtime: true });
  const fallbackBefore = fs.readFileSync(paths.fallbackYtdlpPath, 'utf8');
  const result = await safeUpdateYtDlp(paths, { run: fakeRun, trigger: 'TEST' });
  assert.equal(result.update_status, 'UPDATED');
  assert.equal(fs.readFileSync(paths.ytdlpPath, 'utf8'), 'valid-updated-ytdlp');
  assert.equal(fs.readFileSync(paths.fallbackYtdlpPath, 'utf8'), fallbackBefore);
});

test('fallback remains unchanged when broken update rolls back', async () => {
  const { paths } = setup({ runtime: true });
  const fallbackBefore = fs.readFileSync(paths.fallbackYtdlpPath, 'utf8');
  let updated = false;
  const brokenUpdate = async (executable, args) => {
    if (args[0] === '--update') { updated = true; fs.writeFileSync(executable, 'corrupt'); return { ok: true }; }
    return fakeRun(executable, args);
  };
  const result = await safeUpdateYtDlp(paths, { run: brokenUpdate, trigger: 'TEST' });
  assert.equal(updated, true);
  assert.equal(result.usable, true);
  assert.equal(fs.readFileSync(paths.fallbackYtdlpPath, 'utf8'), fallbackBefore);
});

test('Repair restores missing Deno from fallback', async () => {
  const { paths } = setup({ runtime: true });
  fs.unlinkSync(paths.denoPath);
  const result = await repairYtDlp(paths, { run: fakeRun, diagnose });
  assert.equal(result.usable, true);
  assert.equal(result.recovery_sources.deno, 'fallback');
});

test('Repair restores missing FFmpeg from fallback', async () => {
  const { paths } = setup({ runtime: true });
  fs.unlinkSync(paths.ffmpegPath);
  const result = await repairYtDlp(paths, { run: fakeRun, diagnose });
  assert.equal(result.usable, true);
  assert.equal(result.recovery_sources.ffmpeg, 'fallback');
});

test('missing fallback produces a clear bootstrap failure', async () => {
  const { paths } = setup({ fallback: false });
  const result = await bootstrapRuntime(paths, { run: fakeRun });
  assert.equal(result.ok, false);
  assert.equal(result.engines.ytdlp.fallback_status, 'missing');
});

test('build preflight fails clearly when fallback binaries are missing', () => {
  const { root } = setup({ fallback: false });
  for (const file of ['main.js', 'preload.js', 'renderer.js', 'index.html', 'style.css', 'engine-runtime.js', 'runtime-binaries.js', 'download-manager.js', 'auth-session.js']) {
    fs.writeFileSync(path.join(root, file), 'placeholder');
  }
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resources', 'mascot.png'), 'image');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'test', version: '1.0.0', main: 'main.js',
    build: {
      files: ['**/*', '!resources/bin{,/**/*}'],
      extraResources: [{ from: 'resources/bin/fallback/', to: 'bin/fallback/' }]
    }
  }));
  assert.throws(() => runPreflight({ projectDir: root }), /missing fallback binary: yt-dlp\.exe/);
});

test('fresh-install paths and yt-dlp args never use system binaries', async () => {
  const { paths } = setup();
  const calls = [];
  const run = async (executable, args, options) => {
    calls.push({ executable, pathValue: options.env.PATH });
    return fakeRun(executable, args);
  };
  const result = await bootstrapRuntime(paths, { run, env: { PATH: '' } });
  const args = buildYtDlpBaseArgs({ paths, ffmpeg: true });
  assert.equal(result.ok, true);
  assert.ok(calls.every(call => path.isAbsolute(call.executable) && call.pathValue === ''));
  assert.ok(args.includes(`deno:${paths.denoPath}`));
  assert.ok(args.includes(paths.ffmpegPath));
});
