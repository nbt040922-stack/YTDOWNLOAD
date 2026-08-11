const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FINAL_PATH_PREFIX = '__YTD_FINAL_PATH__:';

function resolveBinaryPaths({ isPackaged, resourcesPath, appDir }) {
  const binPath = isPackaged
    ? path.join(resourcesPath, 'bin')
    : path.join(appDir, 'resources', 'bin');

  return {
    binPath,
    ytdlpPath: path.join(binPath, 'yt-dlp.exe'),
    ffmpegPath: path.join(binPath, 'ffmpeg.exe'),
    denoPath: path.join(binPath, 'deno.exe')
  };
}

function buildYtDlpBaseArgs({ paths, cookiesPath, cookies = true, jsRuntime = true, ffmpeg = false }) {
  const args = ['--encoding', 'utf-8'];
  if (jsRuntime) {
    args.push('--js-runtimes', `deno:${paths.denoPath}`, '--remote-components', 'ejs:github');
  }
  if (cookies && cookiesPath && fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
  if (ffmpeg) args.push('--ffmpeg-location', paths.ffmpegPath);
  return args;
}

function runProcess(executable, args, { env = process.env, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), ...result });
    };

    try {
      child = spawn(executable, args, { env, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: null, stdout, stderr, error: error.message });
      return;
    }

    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', error => finish({ ok: false, code: null, error: error.message }));
    child.on('close', code => finish({ ok: code === 0, code, error: code === 0 ? null : (stderr.trim() || `Exited with code ${code}`) }));

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({ ok: false, code: null, error: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });
}

function firstMatchingLine(text, pattern) {
  return text.split(/\r?\n/).find(line => pattern.test(line)) || null;
}

async function runEngineDiagnostics(paths, env = process.env) {
  const [ytDlp, deno, ffmpeg, encoders] = await Promise.all([
    runProcess(paths.ytdlpPath, ['--version'], { env }),
    runProcess(paths.denoPath, ['--version'], { env }),
    runProcess(paths.ffmpegPath, ['-version'], { env }),
    runProcess(paths.ffmpegPath, ['-hide_banner', '-encoders'], { env })
  ]);

  const status = (filePath, result) => !fs.existsSync(filePath) ? 'missing' : result.ok ? 'ok' : 'cannot_run';
  return {
    resolved_ytdlp_path: paths.ytdlpPath,
    yt_dlp_version: ytDlp.ok ? firstMatchingLine(ytDlp.stdout, /\S/) : null,
    ytdlp_status: status(paths.ytdlpPath, ytDlp),
    resolved_deno_path: paths.denoPath,
    deno_version: deno.ok ? firstMatchingLine(deno.stdout, /^deno\s/i) : null,
    deno_status: status(paths.denoPath, deno),
    resolved_ffmpeg_path: paths.ffmpegPath,
    ffmpeg_version: ffmpeg.ok ? firstMatchingLine(`${ffmpeg.stdout}\n${ffmpeg.stderr}`, /^ffmpeg version\s/i) : null,
    ffmpeg_status: status(paths.ffmpegPath, ffmpeg),
    js_runtime_available: deno.ok,
    h264_available: encoders.ok && /\b(?:libx264|h264_[a-z0-9_]+)\b/i.test(`${encoders.stdout}\n${encoders.stderr}`),
    errors: {
      ytdlp: ytDlp.ok ? null : ytDlp.error,
      deno: deno.ok ? null : deno.error,
      ffmpeg: ffmpeg.ok ? null : ffmpeg.error
    }
  };
}

async function updateYtDlp(paths, env = process.env) {
  const before = await runProcess(paths.ytdlpPath, ['--version'], { env });
  if (!before.ok) {
    return { code: 1, old_version: null, new_version: null, update_status: 'precheck_failed', output: before.error };
  }

  const oldVersion = firstMatchingLine(before.stdout, /\S/);
  const update = await runProcess(paths.ytdlpPath, ['--update'], { env, timeoutMs: 120000 });
  const after = await runProcess(paths.ytdlpPath, ['--version'], { env });
  const newVersion = after.ok ? firstMatchingLine(after.stdout, /\S/) : null;
  const updateStatus = update.ok
    ? (oldVersion === newVersion ? 'already_current' : 'updated')
    : (after.ok ? 'failed_usable' : 'failed_unusable');

  return {
    code: update.ok && after.ok ? 0 : 1,
    old_version: oldVersion,
    new_version: newVersion,
    update_status: updateStatus,
    output: [update.stdout, update.stderr, update.error].filter(Boolean).join('\n')
  };
}

function extractFinalPath(line) {
  const index = line.indexOf(FINAL_PATH_PREFIX);
  return index === -1 ? null : line.slice(index + FINAL_PATH_PREFIX.length).trim();
}

module.exports = {
  FINAL_PATH_PREFIX,
  buildYtDlpBaseArgs,
  extractFinalPath,
  resolveBinaryPaths,
  runEngineDiagnostics,
  runProcess,
  updateYtDlp
};
