const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FINAL_PATH_PREFIX = '__YTD_FINAL_PATH__:';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_STATES = Object.freeze({
  NOT_CHECKED: 'NOT_CHECKED',
  UP_TO_DATE: 'UP_TO_DATE',
  UPDATED: 'UPDATED',
  UPDATE_FAILED_USABLE: 'UPDATE_FAILED_USABLE',
  UPDATE_FAILED_ROLLED_BACK: 'UPDATE_FAILED_ROLLED_BACK',
  RECOVERY_SUCCESS: 'RECOVERY_SUCCESS',
  RECOVERY_FAILED: 'RECOVERY_FAILED'
});

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
    let timer = null;

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

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { child.kill(); } catch (_) {}
        finish({ ok: false, code: null, error: `Timed out after ${timeoutMs}ms` });
      }, timeoutMs);
    }
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

function classifyYtDlpFailure(message = '') {
  const text = String(message).toLowerCase();
  const recoverable = [
    ['n_challenge', /n challenge (?:solving )?failed|failed to solve n challenge/],
    ['nsig', /nsig (?:extraction )?failed|failed to extract nsig/],
    ['images_only', /only images are available/],
    ['format', /requested format is not available/],
    ['player', /(?:player|signature) (?:extraction )?(?:fail\w*|error)|failed to extract.*player/],
    ['extractor', /extractor (?:fail\w*|error)/],
    ['js_challenge', /(?:js|javascript) challenge.*(?:fail\w*|error)|challenge solver.*fail\w*/]
  ];
  const match = recoverable.find(([, pattern]) => pattern.test(text));
  if (match) return { recoverable: true, reason: match[0] };

  const excluded = /invalid url|unsupported url|private video|video is private|deleted video|video unavailable|geo(?:graphical)? restriction|not available in your country|login required|sign in to confirm|sign in to view/;
  return { recoverable: false, reason: excluded.test(text) ? 'content_or_input' : 'unclassified' };
}

function updateLogRecord(result) {
  return {
    update_status: result.update_status,
    old_version: result.old_version || null,
    new_version: result.new_version || null,
    update_trigger: result.update_trigger || null,
    recovery_retry: Boolean(result.recovery_retry),
    rollback_performed: Boolean(result.rollback_performed)
  };
}

async function safeUpdateYtDlp(paths, {
  env = process.env,
  trigger = 'MANUAL',
  run = runProcess,
  fileSystem = fs
} = {}) {
  const backupPath = path.join(path.dirname(paths.ytdlpPath), 'yt-dlp.backup.exe');
  const base = {
    old_version: null,
    new_version: null,
    update_trigger: trigger,
    recovery_retry: false,
    rollback_performed: false,
    backup_path: backupPath
  };
  const before = await run(paths.ytdlpPath, ['--version'], { env });
  base.old_version = before.ok ? firstMatchingLine(before.stdout, /\S/) : null;

  if (!before.ok) {
    return { ...base, code: 1, usable: false, update_status: UPDATE_STATES.RECOVERY_FAILED, output: before.error };
  }

  try {
    fileSystem.copyFileSync(paths.ytdlpPath, backupPath);
  } catch (error) {
    return { ...base, code: 1, usable: true, update_status: UPDATE_STATES.UPDATE_FAILED_USABLE, output: error.message };
  }

  const update = await run(paths.ytdlpPath, ['--update'], { env, timeoutMs: 120000 });
  const after = await run(paths.ytdlpPath, ['--version'], { env });
  const deno = await run(paths.denoPath, ['--version'], { env });
  base.new_version = after.ok ? firstMatchingLine(after.stdout, /\S/) : null;

  if (!after.ok || !deno.ok) {
    try {
      fileSystem.copyFileSync(backupPath, paths.ytdlpPath);
      base.rollback_performed = true;
    } catch (error) {
      return { ...base, code: 1, usable: false, update_status: UPDATE_STATES.RECOVERY_FAILED, output: error.message };
    }
    const restored = await run(paths.ytdlpPath, ['--version'], { env });
    return {
      ...base,
      code: 1,
      usable: restored.ok,
      new_version: restored.ok ? firstMatchingLine(restored.stdout, /\S/) : null,
      update_status: restored.ok ? UPDATE_STATES.UPDATE_FAILED_ROLLED_BACK : UPDATE_STATES.RECOVERY_FAILED,
      output: [update.stderr, update.error, after.error, deno.error].filter(Boolean).join('\n')
    };
  }

  const updateStatus = !update.ok
    ? UPDATE_STATES.UPDATE_FAILED_USABLE
    : base.old_version === base.new_version ? UPDATE_STATES.UP_TO_DATE : UPDATE_STATES.UPDATED;
  return {
    ...base,
    code: update.ok ? 0 : 1,
    usable: true,
    update_status: updateStatus,
    output: [update.stdout, update.stderr, update.error].filter(Boolean).join('\n')
  };
}

async function repairYtDlp(paths, {
  env = process.env,
  run = runProcess,
  diagnose = runEngineDiagnostics,
  fileSystem = fs
} = {}) {
  const backupPath = path.join(path.dirname(paths.ytdlpPath), 'yt-dlp.backup.exe');
  const before = await diagnose(paths, env);
  let rollbackPerformed = false;
  let oldVersion = before.yt_dlp_version;

  if (before.ytdlp_status !== 'ok' && fileSystem.existsSync(backupPath)) {
    try {
      fileSystem.copyFileSync(backupPath, paths.ytdlpPath);
      rollbackPerformed = true;
      await run(paths.ytdlpPath, ['--version'], { env });
    } catch (_) {}
  }

  const diagnostics = await diagnose(paths, env);
  const usable = ['ytdlp', 'deno', 'ffmpeg'].every(name => diagnostics[`${name}_status`] === 'ok');
  return {
    code: usable ? 0 : 1,
    usable,
    update_status: usable ? UPDATE_STATES.RECOVERY_SUCCESS : UPDATE_STATES.RECOVERY_FAILED,
    old_version: oldVersion,
    new_version: diagnostics.yt_dlp_version,
    update_trigger: 'REPAIR',
    recovery_retry: false,
    rollback_performed: rollbackPerformed,
    diagnostics,
    output: usable ? 'Downloader engines are usable' : 'One or more downloader engines are unusable'
  };
}

function shouldCheckForUpdate(lastUpdateCheck, now = Date.now()) {
  const last = Date.parse(lastUpdateCheck);
  return !Number.isFinite(last) || now - last >= UPDATE_INTERVAL_MS;
}

async function periodicUpdateCheck({ settings, saveSettings, paths, now = Date.now(), update = safeUpdateYtDlp }) {
  if (!shouldCheckForUpdate(settings.last_update_check, now)) {
    return { update_status: UPDATE_STATES.NOT_CHECKED, update_trigger: 'PERIODIC', recovery_retry: false, rollback_performed: false };
  }

  let result;
  try {
    result = await update(paths, { trigger: 'PERIODIC' });
  } catch (error) {
    result = {
      code: 1,
      usable: true,
      update_status: UPDATE_STATES.UPDATE_FAILED_USABLE,
      old_version: settings.last_known_version || null,
      new_version: settings.last_known_version || null,
      update_trigger: 'PERIODIC',
      recovery_retry: false,
      rollback_performed: false,
      output: error.message
    };
  }
  saveSettings({
    last_update_check: new Date(now).toISOString(),
    last_known_version: result.new_version || result.old_version || settings.last_known_version || null,
    last_update_result: result.update_status
  });
  return result;
}

async function executeWithRecovery({ operation, recover, trigger, logger = () => {} }) {
  const first = await operation(false);
  const classification = classifyYtDlpFailure([first.stderr, first.error].filter(Boolean).join('\n'));
  if (first.ok || !classification.recoverable) {
    return { ...first, recovery: { update_status: UPDATE_STATES.NOT_CHECKED, update_trigger: trigger, recovery_retry: false, rollback_performed: false } };
  }

  const update = await recover(trigger);
  if (!update.usable) {
    const recovery = { ...update, update_status: UPDATE_STATES.RECOVERY_FAILED, recovery_retry: false };
    logger(updateLogRecord(recovery));
    return { ...first, recovery };
  }

  const retry = await operation(true);
  const recovery = {
    ...update,
    update_status: retry.ok ? UPDATE_STATES.RECOVERY_SUCCESS : UPDATE_STATES.RECOVERY_FAILED,
    recovery_retry: true
  };
  logger(updateLogRecord(recovery));
  return { ...retry, recovery };
}

async function updateYtDlp(paths, env = process.env) {
  return safeUpdateYtDlp(paths, { env, trigger: 'MANUAL' });
}

function extractFinalPath(line) {
  const index = line.indexOf(FINAL_PATH_PREFIX);
  return index === -1 ? null : line.slice(index + FINAL_PATH_PREFIX.length).trim();
}

module.exports = {
  FINAL_PATH_PREFIX,
  UPDATE_INTERVAL_MS,
  UPDATE_STATES,
  buildYtDlpBaseArgs,
  classifyYtDlpFailure,
  executeWithRecovery,
  extractFinalPath,
  periodicUpdateCheck,
  repairYtDlp,
  resolveBinaryPaths,
  runEngineDiagnostics,
  runProcess,
  safeUpdateYtDlp,
  shouldCheckForUpdate,
  updateLogRecord,
  updateYtDlp
};
