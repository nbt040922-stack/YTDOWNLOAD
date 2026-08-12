const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { ContentOpsBridge, LOOPBACK, validateRequest } = require('../contentops-bridge');
const { DownloadManager } = require('../download-manager');

function request(overrides = {}) {
  return {
    handoff_id: '123',
    video_id: 'abcdefghijk',
    video_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    channel_name: 'Test Channel',
    work_dir: 'D:\\ContentOps_Work\\123',
    final_output_dir: '\\\\NAS\\ContentOps\\Test Channel',
    ...overrides
  };
}

function setup(root, executor = async () => ({ ok: true, outputPath: 'D:\\ContentOps_Work\\123\\source.mp4' })) {
  const manager = new DownloadManager({
    jobsPath: path.join(root, 'legacy.json'),
    executor,
    fileExists: () => true,
    idFactory: (() => { let id = 0; return () => `manager-${++id}`; })()
  });
  const bridge = new ContentOpsBridge({ manager, recordsPath: path.join(root, 'handoffs.json'), port: 0 });
  return { bridge, manager };
}

test('bridge rejects non-loopback bind', () => {
  assert.throws(
    () => new ContentOpsBridge({ manager: {}, recordsPath: 'unused', host: '0.0.0.0' }),
    /must bind to 127\.0\.0\.1/
  );
});

function httpJson(method, port, route, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const request = http.request({ hostname: LOOPBACK, port, path: route, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      let value = '';
      response.on('data', chunk => { value += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(value) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('POST adapter enqueues once and preserves manual enqueue path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contentops-'));
  const { bridge, manager } = setup(root);
  const first = bridge.submit(request());
  const duplicate = bridge.submit(request());
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.job.external_id, duplicate.job.external_id);
  assert.equal(manager.list().length, 1);
  assert.equal(manager.enqueue({ url: 'https://youtu.be/manual12345', output_directory: 'D:\\Manual' }).added, true);
});

test('failed enqueue rolls back handoff so POST retry can succeed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contentops-'));
  const { bridge, manager } = setup(root);
  const enqueue = manager.enqueue.bind(manager);
  let attempts = 0;
  manager.enqueue = input => {
    if (++attempts === 1) throw new Error('enqueue failed');
    return enqueue(input);
  };
  const address = await bridge.start();
  const failed = await httpJson('POST', address.port, '/api/download-jobs', request());
  const retried = await httpJson('POST', address.port, '/api/download-jobs', request());
  assert.equal(failed.status, 400);
  assert.equal(retried.status, 201);
  assert.equal(retried.body.external_id, 'contentops-123');
  assert.equal(manager.list().length, 1);
  assert.equal(bridge.records.size, 1);
  assert.equal(bridge.get('contentops-123').manager_job_id, manager.list()[0].id);
  await bridge.stop();
});

test('invalid request is rejected', () => {
  assert.throws(() => validateRequest(request({ video_url: 'https://example.com/video' })), /Invalid video_url/);
  assert.throws(() => validateRequest(request({ video_url: 'https://www.youtube.com/watch?v=wrongvideo1' })), /Invalid video_url/);
  assert.throws(() => validateRequest(request({ work_dir: 'relative' })), /Invalid download destination/);
});

test('GET state returns exact verified path when DONE', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contentops-'));
  const { bridge, manager } = setup(root);
  const externalId = bridge.submit(request()).job.external_id;
  manager.start();
  await manager.waitForIdle();
  const job = bridge.get(externalId);
  assert.equal(job.state, 'DONE');
  assert.equal(job.downloaded_file_path, 'D:\\ContentOps_Work\\123\\source.mp4');
});

test('restart restores active handoff without changing external id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contentops-'));
  const first = setup(root);
  const externalId = first.bridge.submit(request()).job.external_id;
  const second = setup(root);
  second.bridge.restore();
  assert.equal(second.bridge.submit(request()).job.external_id, externalId);
  assert.equal(second.manager.list().length, 1);
});

test('restore removes active mapping when re-enqueue fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contentops-'));
  setup(root).bridge.submit(request());
  const { bridge } = setup(root);
  bridge.manager.enqueue = () => { throw new Error('enqueue failed'); };
  bridge.restore();
  assert.equal(bridge.records.size, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'handoffs.json'), 'utf8')), []);
});

test('localhost bridge lifecycle is clean', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contentops-'));
  const { bridge } = setup(root);
  const address = await bridge.start();
  assert.equal(address.address, LOOPBACK);
  assert.deepEqual((await httpJson('GET', address.port, '/health')).body, { status: 'ok' });
  const created = await httpJson('POST', address.port, '/api/download-jobs', request());
  const duplicate = await httpJson('POST', address.port, '/api/download-jobs', request());
  const fetched = await httpJson('GET', address.port, `/api/download-jobs/${created.body.external_id}`);
  assert.equal(created.status, 201);
  assert.equal(duplicate.status, 200);
  assert.equal(fetched.body.external_id, created.body.external_id);
  await bridge.stop();
});
