const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FINAL_PATH_PREFIX,
  buildYtDlpBaseArgs,
  extractFinalPath,
  resolveBinaryPaths,
  runEngineDiagnostics
} = require('../engine-runtime');

const appDir = path.resolve(__dirname, '..');
const paths = resolveBinaryPaths({ isPackaged: false, resourcesPath: '', appDir });

test('shared yt-dlp args use bundled engines and omit stale workarounds', () => {
  const args = buildYtDlpBaseArgs({ paths, cookiesPath: null, ffmpeg: true });
  assert.deepEqual(args, [
    '--encoding', 'utf-8',
    '--js-runtimes', `deno:${paths.denoPath}`,
    '--remote-components', 'ejs:github',
    '--ffmpeg-location', paths.ffmpegPath
  ]);
  assert.equal(args.includes('--no-check-certificate'), false);
  assert.equal(args.includes('--extractor-args'), false);
  assert.equal(args.includes('--restrict-filenames'), false);
});

test('final path reporting preserves Unicode exactly', () => {
  const expected = String.raw`C:\動画\日本語 한국어 Tiếng Việt 🎵.mp4`;
  assert.equal(extractFinalPath(`${FINAL_PATH_PREFIX}${expected}`), expected);
  assert.equal(extractFinalPath('[download] 100%'), null);
});

test('bundled engines execute successfully', async () => {
  const diagnostics = await runEngineDiagnostics(paths);
  assert.equal(diagnostics.ytdlp_status, 'ok');
  assert.equal(diagnostics.deno_status, 'ok');
  assert.equal(diagnostics.ffmpeg_status, 'ok');
  assert.equal(diagnostics.js_runtime_available, true);
  assert.equal(diagnostics.h264_available, true);
});

test('diagnostics report missing binaries distinctly', async () => {
  const missingPaths = {
    ytdlpPath: path.join(appDir, 'missing-yt-dlp.exe'),
    denoPath: path.join(appDir, 'missing-deno.exe'),
    ffmpegPath: path.join(appDir, 'missing-ffmpeg.exe')
  };
  const diagnostics = await runEngineDiagnostics(missingPaths);
  assert.equal(diagnostics.ytdlp_status, 'missing');
  assert.equal(diagnostics.deno_status, 'missing');
  assert.equal(diagnostics.ffmpeg_status, 'missing');
});

test('diagnostics report an existing unlaunchable binary distinctly', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-runtime-test-'));
  const brokenBinary = path.join(tempDir, 'broken.exe');
  fs.writeFileSync(brokenBinary, 'not an executable');
  try {
    const diagnostics = await runEngineDiagnostics({
      ytdlpPath: brokenBinary,
      denoPath: brokenBinary,
      ffmpegPath: brokenBinary
    });
    assert.equal(diagnostics.ytdlp_status, 'cannot_run');
    assert.equal(diagnostics.deno_status, 'cannot_run');
    assert.equal(diagnostics.ffmpeg_status, 'cannot_run');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
