const fs = require('fs');
const http = require('http');
const path = require('path');

const LOOPBACK = '127.0.0.1';
const ACTIVE_STATES = new Set(['QUEUED', 'METADATA', 'DOWNLOADING', 'MERGING', 'VERIFYING']);

function validateRequest(input) {
  const request = {
    handoff_id: String(input?.handoff_id || '').trim(),
    video_id: String(input?.video_id || '').trim(),
    video_url: String(input?.video_url || '').trim(),
    channel_name: String(input?.channel_name || '').trim(),
    work_dir: String(input?.work_dir || '').trim(),
    final_output_dir: String(input?.final_output_dir || '').trim()
  };
  let url;
  try { url = new URL(request.video_url); } catch (_) { throw new Error('Invalid video_url'); }
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(request.handoff_id)) throw new Error('Invalid handoff_id');
  if (!/^[A-Za-z0-9_-]{11}$/.test(request.video_id)) throw new Error('Invalid video_id');
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com'].includes(url.hostname)
    || url.pathname !== '/watch' || url.searchParams.get('v') !== request.video_id) throw new Error('Invalid video_url');
  if (!request.channel_name || !path.isAbsolute(request.work_dir) || !path.isAbsolute(request.final_output_dir)) throw new Error('Invalid download destination');
  return request;
}

class ContentOpsBridge {
  constructor({ manager, recordsPath, port = 8790, fileSystem = fs, host = LOOPBACK }) {
    if (host !== LOOPBACK) throw new Error('Content Ops bridge must bind to 127.0.0.1');
    this.manager = manager;
    this.recordsPath = recordsPath;
    this.port = port;
    this.host = host;
    this.fileSystem = fileSystem;
    this.records = new Map();
    this.server = null;
    this._load();
    this.manager.on('jobs', jobs => this._sync(jobs));
  }

  _load() {
    if (!this.fileSystem.existsSync(this.recordsPath)) return;
    try {
      const rows = JSON.parse(this.fileSystem.readFileSync(this.recordsPath, 'utf8'));
      if (Array.isArray(rows)) rows.forEach(row => this.records.set(row.handoff_id, row));
    } catch (_) {
      this.records.clear();
    }
  }

  _save() {
    const temporary = `${this.recordsPath}.tmp`;
    this.fileSystem.mkdirSync(path.dirname(this.recordsPath), { recursive: true });
    this.fileSystem.writeFileSync(temporary, JSON.stringify([...this.records.values()], null, 2), 'utf8');
    this.fileSystem.renameSync(temporary, this.recordsPath);
  }

  _enqueue(record) {
    const result = this.manager.enqueue({
      url: record.request.video_url,
      output_directory: record.request.work_dir,
      title: `Content Ops · ${record.request.channel_name}`
    });
    record.manager_job_id = result.job.id;
    record.state = result.job.state;
    record.updated_at = new Date().toISOString();
    this._save();
    return record;
  }

  restore() {
    const jobs = this.manager.list();
    for (const record of this.records.values()) {
      if (!ACTIVE_STATES.has(record.state)) continue;
      if (!jobs.some(job => job.id === record.manager_job_id)) this._enqueue(record);
    }
    this._sync(this.manager.list());
  }

  submit(input) {
    const request = validateRequest(input);
    const existing = this.records.get(request.handoff_id);
    if (existing) return { created: false, job: { ...existing } };
    const now = new Date().toISOString();
    const record = {
      handoff_id: request.handoff_id,
      external_id: `contentops-${request.handoff_id}`,
      manager_job_id: null,
      request,
      state: 'QUEUED',
      progress_percent: 0,
      downloaded_file_path: null,
      error: null,
      created_at: now,
      updated_at: now
    };
    this.records.set(request.handoff_id, record);
    this._enqueue(record);
    return { created: true, job: { ...record } };
  }

  get(externalId) {
    const record = [...this.records.values()].find(item => item.external_id === externalId);
    return record ? { ...record } : null;
  }

  _sync(jobs) {
    let changed = false;
    for (const record of this.records.values()) {
      const job = jobs.find(item => item.id === record.manager_job_id);
      if (!job) continue;
      const error = job.state === 'FAILED' || job.state === 'CANCELLED'
        ? job.last_error_message || job.last_error_category || job.state
        : null;
      Object.assign(record, {
        state: job.state,
        progress_percent: job.progress_percent || 0,
        downloaded_file_path: job.exact_output_path || null,
        error,
        updated_at: new Date().toISOString()
      });
      changed = true;
    }
    if (changed) this._save();
  }

  start() {
    if (this.server) return Promise.resolve(this.server.address());
    this.server = http.createServer((request, response) => this._handle(request, response));
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => resolve(this.server.address()));
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = null;
    return new Promise(resolve => server.close(resolve));
  }

  _json(response, status, payload) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  }

  _handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') return this._json(response, 200, { status: 'ok' });
    if (request.method === 'GET' && url.pathname.startsWith('/api/download-jobs/')) {
      const job = this.get(decodeURIComponent(url.pathname.slice('/api/download-jobs/'.length)));
      return this._json(response, job ? 200 : 404, job || { error: 'NOT_FOUND' });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/download-jobs') return this._json(response, 404, { error: 'NOT_FOUND' });
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 64 * 1024) request.destroy();
    });
    request.on('end', () => {
      try {
        const result = this.submit(JSON.parse(body));
        this._json(response, result.created ? 201 : 200, result.job);
      } catch (error) {
        this._json(response, 400, { error: 'INVALID_REQUEST', message: error.message });
      }
    });
  }
}

module.exports = { ContentOpsBridge, LOOPBACK, validateRequest };
