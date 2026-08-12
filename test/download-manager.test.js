const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DownloadManager,
  JOB_STATES,
  parseYtDlpProgress,
  safeMessage
} = require('../download-manager');

const tempDirs = [];
test.afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function setup(executor, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-manager-'));
  tempDirs.push(directory);
  let nextId = 0;
  const manager = new DownloadManager({
    jobsPath: path.join(directory, 'download-jobs.json'),
    executor,
    fileExists: options.fileExists || (() => true),
    maxConcurrent: options.maxConcurrent || 2,
    logger: options.logger || (() => {}),
    idFactory: () => `job-${++nextId}`
  });
  return { directory, manager };
}

function input(url = 'https://youtube.com/watch?v=1', extra = {}) {
  return { url, output_directory: 'C:\\Downloads', ...extra };
}

function success() {
  return { ok: true, outputPath: 'C:\\Downloads\\video.mp4' };
}

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

test('concurrency never exceeds configured limit', async () => {
  let active = 0;
  let maximum = 0;
  const { manager } = setup(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return success();
  });
  manager.enqueueMany([input('u1'), input('u2'), input('u3'), input('u4')]);
  manager.start();
  await manager.waitForIdle();
  assert.equal(maximum, 2);
});

test('next queued job starts when a slot becomes free', async () => {
  const releases = [];
  const started = [];
  const { manager } = setup(job => new Promise(resolve => {
    started.push(job.id);
    releases.push(() => resolve(success()));
  }));
  manager.enqueueMany([input('u1'), input('u2'), input('u3')]);
  manager.start();
  assert.deepEqual(started, ['job-1', 'job-2']);
  releases[0]();
  await flush();
  assert.deepEqual(started, ['job-1', 'job-2', 'job-3']);
  releases.slice(1).forEach(release => release());
  await manager.waitForIdle();
});

test('queued job can be cancelled without spawning', () => {
  let calls = 0;
  const { manager } = setup(async () => { calls++; return success(); });
  const id = manager.enqueue(input()).job.id;
  assert.equal(manager.cancel(id), true);
  manager.start();
  assert.equal(calls, 0);
  assert.equal(manager.list()[0].state, JOB_STATES.CANCELLED);
});

test('active job cancellation kills its process', async () => {
  let killed = false;
  const { manager } = setup((job, context) => new Promise(resolve => {
    context.registerProcess({ kill() { killed = true; resolve({ ok: false, cancelled: true }); } });
  }));
  const id = manager.enqueue(input()).job.id;
  manager.start();
  manager.cancel(id);
  await manager.waitForIdle();
  assert.equal(killed, true);
});

test('cancelled jobs are not reported as failed', async () => {
  const { manager } = setup((job, context) => new Promise(resolve => {
    context.registerProcess({ kill() { resolve({ ok: false, errorMessage: 'killed' }); } });
  }));
  const id = manager.enqueue(input()).job.id;
  manager.start();
  manager.cancel(id);
  await manager.waitForIdle();
  assert.equal(manager.list()[0].state, JOB_STATES.CANCELLED);
});

test('transient error retries once', async () => {
  let calls = 0;
  const { manager } = setup(async () => ++calls === 1
    ? { ok: false, errorMessage: 'connection reset by peer' }
    : success());
  manager.enqueue(input());
  manager.start();
  await manager.waitForIdle();
  assert.equal(calls, 2);
  assert.equal(manager.list()[0].state, JOB_STATES.DONE);
  assert.equal(manager.list()[0].retry_count, 1);
});

test('permanent content error does not retry', async () => {
  let calls = 0;
  const { manager } = setup(async () => { calls++; return { ok: false, errorMessage: 'private video' }; });
  manager.enqueue(input());
  manager.start();
  await manager.waitForIdle();
  assert.equal(calls, 1);
  assert.equal(manager.list()[0].last_error_category, 'PERMANENT');
});

test('Phase 2 engine recovery does not create a normal retry loop', async () => {
  let managerCalls = 0;
  let recoveryCalls = 0;
  const { manager } = setup(async () => {
    managerCalls++;
    recoveryCalls++;
    return { ok: false, errorMessage: 'n challenge solving failed', engineFailure: true };
  });
  manager.enqueue(input());
  manager.start();
  await manager.waitForIdle();
  assert.equal(managerCalls, 1);
  assert.equal(recoveryCalls, 1);
  assert.equal(manager.list()[0].last_error_category, 'ENGINE');
});

test('new app session starts with an empty queue', () => {
  const { directory, manager } = setup(async () => success());
  manager.enqueue(input('session-only'));
  const nextSession = new DownloadManager({
    jobsPath: path.join(directory, 'download-jobs.json'),
    executor: async () => success()
  });
  nextSession.load();
  assert.deepEqual(nextSession.list(), []);
  assert.equal(fs.existsSync(path.join(directory, 'download-jobs.json')), false);
});

test('previous download-jobs cache is normalized then discarded', () => {
  const { directory, manager } = setup(async () => success());
  const records = [];
  manager.logger = record => records.push(record);
  fs.writeFileSync(manager.jobsPath, JSON.stringify([
    { ...input('done'), id: 'done', state: 'DONE', progress_percent: 0, speed: 123, eta: 8 },
    { ...input('crashed'), id: 'old', state: 'DOWNLOADING', progress_percent: 72 }
  ]));
  manager.load();
  assert.deepEqual(manager.list(), []);
  assert.equal(records.find(record => record.event === 'legacy_cache_discarded').normalized_done_count, 1);
  assert.equal(fs.existsSync(manager.jobsPath), false);
});

test('legacy queue cleanup is safe when cache is absent or invalid', () => {
  const { manager } = setup(async () => success());
  assert.deepEqual(manager.load(), []);
  fs.writeFileSync(manager.jobsPath, '{invalid');
  assert.deepEqual(manager.load(), []);
  assert.equal(fs.existsSync(manager.jobsPath), false);
});

test('DONE requires exact output path to exist', async () => {
  const { manager } = setup(async () => success(), { fileExists: () => false });
  manager.enqueue(input());
  manager.start();
  await manager.waitForIdle();
  assert.equal(manager.list()[0].state, JOB_STATES.FAILED);
  assert.equal(manager.list()[0].last_error_category, 'VERIFYING');
});

test('DONE transition forces progress to 100 and clears live telemetry', async () => {
  const { manager } = setup(async (job, context) => {
    context.update({ progress_percent: 0, speed: 500, eta: 20 });
    return success();
  });
  manager.enqueue(input());
  manager.start();
  await manager.waitForIdle();
  assert.equal(manager.jobs[0].state, JOB_STATES.DONE);
  assert.equal(manager.jobs[0].progress_percent, 100);
  assert.equal(manager.jobs[0].speed, null);
  assert.equal(manager.jobs[0].eta, null);
});

test('DONE snapshot never reports zero percent', () => {
  const { manager } = setup(async () => success());
  manager.jobs = [{ id: 'legacy', state: JOB_STATES.DONE, progress_percent: 0, speed: 1, eta: 1 }];
  assert.equal(manager.list()[0].progress_percent, 100);
  assert.equal(manager.list()[0].speed, null);
  assert.equal(manager.list()[0].eta, null);
});

test('playlist items use the same manager and concurrency', async () => {
  const seen = [];
  const { manager } = setup(async job => { seen.push(job.url); return success(); });
  manager.enqueueMany([
    input('playlist-1', { subdirectory: 'Channel' }),
    input('playlist-2', { subdirectory: 'Channel' }),
    input('playlist-3', { subdirectory: 'Channel' })
  ]);
  manager.start();
  await manager.waitForIdle();
  assert.deepEqual(seen.sort(), ['playlist-1', 'playlist-2', 'playlist-3']);
  assert.ok(manager.list().every(job => job.state === JOB_STATES.DONE));
});

test('duplicate queued or active URL and destination is prevented', () => {
  const { manager } = setup(async () => success());
  assert.equal(manager.enqueue(input()).added, true);
  const duplicate = manager.enqueue(input());
  assert.equal(duplicate.added, false);
  assert.equal(manager.list().length, 1);
});

test('failed job can be manually retried', async () => {
  let calls = 0;
  const { manager } = setup(async () => ++calls === 1
    ? { ok: false, errorMessage: 'invalid URL' }
    : success());
  const id = manager.enqueue(input()).job.id;
  manager.start();
  await manager.waitForIdle();
  assert.equal(manager.retry(id), true);
  await manager.waitForIdle();
  assert.equal(calls, 2);
  assert.equal(manager.list()[0].state, JOB_STATES.DONE);
});

test('cancel all handles queued and active jobs', async () => {
  const { manager } = setup((job, context) => new Promise(resolve => {
    context.registerProcess({ kill() { resolve({ ok: false, cancelled: true }); } });
  }), { maxConcurrent: 1 });
  manager.enqueueMany([input('active'), input('queued-1'), input('queued-2')]);
  manager.start();
  manager.cancelAll();
  await manager.waitForIdle();
  assert.deepEqual(manager.list().map(job => job.state), ['CANCELLED', 'CANCELLED', 'CANCELLED']);
});

test('machine-readable yt-dlp progress is parsed', () => {
  const parsed = parseYtDlpProgress('[download] __YTD_PROGRESS__:42.5%|425|1000|NA|250|3');
  assert.deepEqual(parsed, {
    progress_percent: 42.5,
    downloaded_bytes: 425,
    total_bytes: 1000,
    speed: 250,
    eta: 3
  });
});

test('safe job messages redact cookie and authorization values', () => {
  const message = safeMessage('cookie=session-secret authorization: Bearer token-secret');
  assert.doesNotMatch(message, /session-secret|token-secret/);
});
