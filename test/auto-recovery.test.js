const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  UPDATE_STATES,
  executeWithRecovery,
  periodicUpdateCheck,
  repairYtDlp,
  safeUpdateYtDlp
} = require('../engine-runtime');

const paths = {
  ytdlpPath: path.join('C:', 'app', 'bin', 'yt-dlp.exe'),
  denoPath: path.join('C:', 'app', 'bin', 'deno.exe'),
  ffmpegPath: path.join('C:', 'app', 'bin', 'ffmpeg.exe')
};

function recoveryUpdate() {
  return Promise.resolve({ usable: true, update_status: UPDATE_STATES.UPDATED, old_version: '1', new_version: '2' });
}

test('periodic check respects the 24-hour interval', async () => {
  let updateCalls = 0;
  const now = Date.parse('2026-08-11T00:00:00Z');
  const result = await periodicUpdateCheck({
    settings: { last_update_check: '2026-08-10T01:00:01Z' },
    saveSettings: () => assert.fail('settings must not change before 24 hours'),
    paths,
    now,
    update: async () => { updateCalls++; }
  });
  assert.equal(result.update_status, UPDATE_STATES.NOT_CHECKED);
  assert.equal(updateCalls, 0);
});

test('offline update check does not block startup', async () => {
  let saved;
  const result = await periodicUpdateCheck({
    settings: {},
    saveSettings: value => { saved = value; },
    paths,
    now: Date.parse('2026-08-11T00:00:00Z'),
    update: async () => { throw new Error('offline'); }
  });
  assert.equal(result.update_status, UPDATE_STATES.UPDATE_FAILED_USABLE);
  assert.equal(saved.last_update_result, UPDATE_STATES.UPDATE_FAILED_USABLE);
});

test('n challenge failure triggers one recovery update', async () => {
  let operations = 0;
  let updates = 0;
  const result = await executeWithRecovery({
    operation: async () => ++operations === 1
      ? { ok: false, stderr: 'n challenge solving failed' }
      : { ok: true, stdout: 'ok' },
    recover: async () => { updates++; return recoveryUpdate(); },
    trigger: 'TEST'
  });
  assert.equal(result.ok, true);
  assert.equal(updates, 1);
  assert.equal(operations, 2);
});

test('nsig failure triggers one recovery update', async () => {
  let operations = 0;
  let updates = 0;
  await executeWithRecovery({
    operation: async () => ++operations === 1
      ? { ok: false, stderr: 'nsig extraction failed' }
      : { ok: true },
    recover: async () => { updates++; return recoveryUpdate(); },
    trigger: 'TEST'
  });
  assert.equal(updates, 1);
  assert.equal(operations, 2);
});

test('non-engine failure does not trigger update', async () => {
  let updates = 0;
  const result = await executeWithRecovery({
    operation: async () => ({ ok: false, stderr: 'This video is private. Login required' }),
    recover: async () => { updates++; return recoveryUpdate(); },
    trigger: 'TEST'
  });
  assert.equal(result.ok, false);
  assert.equal(updates, 0);
});

test('failed recovery retry happens exactly once', async () => {
  let operations = 0;
  let updates = 0;
  const result = await executeWithRecovery({
    operation: async () => { operations++; return { ok: false, stderr: 'JS challenge solver failure' }; },
    recover: async () => { updates++; return recoveryUpdate(); },
    trigger: 'TEST'
  });
  assert.equal(result.recovery.update_status, UPDATE_STATES.RECOVERY_FAILED);
  assert.equal(result.recovery.recovery_retry, true);
  assert.equal(operations, 2);
  assert.equal(updates, 1);
});

test('broken updated binary rolls back', async () => {
  let broken = false;
  let backupCreated = false;
  const fileSystem = {
    copyFileSync(source) {
      if (source === paths.ytdlpPath) backupCreated = true;
      else broken = false;
    }
  };
  const run = async (executable, args) => {
    if (args[0] === '--update') { broken = true; return { ok: true, stdout: 'updated' }; }
    if (executable === paths.denoPath) return { ok: true, stdout: 'deno 2' };
    return broken ? { ok: false, error: 'broken' } : { ok: true, stdout: '1' };
  };
  const result = await safeUpdateYtDlp(paths, { run, fileSystem, trigger: 'TEST' });
  assert.equal(backupCreated, true);
  assert.equal(result.rollback_performed, true);
  assert.equal(result.usable, true);
  assert.equal(result.update_status, UPDATE_STATES.UPDATE_FAILED_ROLLED_BACK);
});

test('successful update keeps the new binary', async () => {
  let version = '1';
  let copies = 0;
  const run = async (executable, args) => {
    if (args[0] === '--update') { version = '2'; return { ok: true, stdout: 'updated' }; }
    if (executable === paths.denoPath) return { ok: true, stdout: 'deno 2' };
    return { ok: true, stdout: version };
  };
  const result = await safeUpdateYtDlp(paths, {
    run,
    fileSystem: { copyFileSync: () => { copies++; } },
    trigger: 'TEST'
  });
  assert.equal(copies, 1);
  assert.equal(result.new_version, '2');
  assert.equal(result.rollback_performed, false);
  assert.equal(result.update_status, UPDATE_STATES.UPDATED);
});

test('manual Repair restores a usable backup', async () => {
  let diagnoses = 0;
  let restored = false;
  const diagnose = async () => ++diagnoses === 1
    ? { ytdlp_status: 'cannot_run', yt_dlp_version: null, deno_status: 'ok', ffmpeg_status: 'ok' }
    : { ytdlp_status: 'ok', yt_dlp_version: '1', deno_status: 'ok', ffmpeg_status: 'ok' };
  const result = await repairYtDlp(paths, {
    diagnose,
    run: async () => ({ ok: true, stdout: '1' }),
    fileSystem: {
      existsSync: () => true,
      copyFileSync: () => { restored = true; }
    }
  });
  assert.equal(restored, true);
  assert.equal(result.rollback_performed, true);
  assert.equal(result.update_status, UPDATE_STATES.RECOVERY_SUCCESS);
});

test('cookie and authorization content never enters recovery logs', async () => {
  const logs = [];
  let attempts = 0;
  await executeWithRecovery({
    operation: async () => ++attempts === 1
      ? { ok: false, stderr: 'Cookie: SID=secret Authorization: Bearer token n challenge solving failed' }
      : { ok: true },
    recover: recoveryUpdate,
    trigger: 'TEST',
    logger: record => logs.push(JSON.stringify(record))
  });
  const output = logs.join('\n');
  assert.equal(output.includes('SID=secret'), false);
  assert.equal(output.includes('Bearer token'), false);
  assert.equal(output.includes('Cookie:'), false);
});
