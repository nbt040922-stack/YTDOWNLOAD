const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const PROGRESS_PREFIX = '__YTD_PROGRESS__:';

const JOB_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  METADATA: 'METADATA',
  DOWNLOADING: 'DOWNLOADING',
  MERGING: 'MERGING',
  VERIFYING: 'VERIFYING',
  DONE: 'DONE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

const ACTIVE_STATES = new Set([
  JOB_STATES.QUEUED,
  JOB_STATES.METADATA,
  JOB_STATES.DOWNLOADING,
  JOB_STATES.MERGING,
  JOB_STATES.VERIFYING
]);
const INTERRUPTED_STATES = new Set([
  JOB_STATES.METADATA,
  JOB_STATES.DOWNLOADING,
  JOB_STATES.MERGING,
  JOB_STATES.VERIFYING
]);

function safeMessage(message) {
  return String(message || 'Unknown error')
    .replace(/(?:set-)?cookie\s*[:=]\s*[^\r\n]+/gi, 'cookie=[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\r\n]+/gi, 'authorization=[REDACTED]')
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:access|refresh|oauth|session)[_-]?token\s*[:=]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[REDACTED]')
    .slice(0, 500);
}

function classifyRetry(message) {
  const text = String(message || '').toLowerCase();
  if (/invalid url|unsupported url|private video|video is private|deleted video|video unavailable|geo(?:graphical)? restriction|not available in your country|login required|sign in to/.test(text)) {
    return 'PERMANENT';
  }
  if (/connection reset|econnreset|temporary network|temporarily unavailable|timed? out|timeout|http error 5\d\d|server error 5\d\d/.test(text)) {
    return 'TRANSIENT';
  }
  return 'UNKNOWN';
}

function parseYtDlpProgress(line) {
  const index = String(line).indexOf(PROGRESS_PREFIX);
  if (index === -1) return null;
  const [percent, downloaded, total, estimate, speed, eta] = String(line)
    .slice(index + PROGRESS_PREFIX.length)
    .split('|');
  const number = value => value && value !== 'NA' ? Number(String(value).replace('%', '').trim()) : null;
  return {
    progress_percent: number(percent) || 0,
    downloaded_bytes: number(downloaded) || 0,
    total_bytes: number(total) || number(estimate),
    speed: number(speed),
    eta: number(eta)
  };
}

function persistedJob(job) {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    thumbnail: job.thumbnail,
    output_directory: job.output_directory,
    subdirectory: job.subdirectory,
    created_time: job.created_time,
    state: job.state,
    progress_percent: job.progress_percent,
    downloaded_bytes: job.downloaded_bytes,
    total_bytes: job.total_bytes,
    speed: job.speed,
    eta: job.eta,
    exact_output_path: job.exact_output_path,
    last_error_category: job.last_error_category,
    last_error_message: job.last_error_message,
    retry_count: job.retry_count
  };
}

class DownloadManager extends EventEmitter {
  constructor({
    jobsPath,
    executor,
    maxConcurrent = 2,
    fileSystem = fs,
    fileExists = fileSystem.existsSync.bind(fileSystem),
    logger = () => {},
    now = () => Date.now(),
    idFactory = () => `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }) {
    super();
    this.jobsPath = jobsPath;
    this.executor = executor;
    this.maxConcurrent = maxConcurrent;
    this.fileSystem = fileSystem;
    this.fileExists = fileExists;
    this.logger = logger;
    this.now = now;
    this.idFactory = idFactory;
    this.jobs = [];
    this.active = new Map();
    this.running = false;
    this.lastProgressPersist = new Map();
    this.idleResolvers = [];
  }

  load() {
    try {
      if (!this.fileSystem.existsSync(this.jobsPath)) return [];
      const loaded = JSON.parse(this.fileSystem.readFileSync(this.jobsPath, 'utf8'));
      this.jobs = Array.isArray(loaded) ? loaded.map(job => ({
        ...job,
        state: INTERRUPTED_STATES.has(job.state) ? JOB_STATES.QUEUED : job.state,
        progress_percent: INTERRUPTED_STATES.has(job.state) ? 0 : Number(job.progress_percent || 0),
        retry_count: Number(job.retry_count || 0)
      })) : [];
      this._persist();
    } catch (error) {
      this.jobs = [];
      this.logger({ event: 'load_failed', failure_category: 'PERSISTENCE', message: safeMessage(error.message) });
    }
    return this.list();
  }

  start() {
    this.running = true;
    this._drain();
  }

  stop() {
    this.running = false;
  }

  list() {
    return this.jobs.map(job => ({ ...persistedJob(job) }));
  }

  enqueue(input) {
    const url = String(input.url || '').trim();
    const outputDirectory = String(input.output_directory || '').trim();
    const subdirectory = input.subdirectory || null;
    if (!url || !outputDirectory) throw new Error('URL and output directory are required');
    const duplicate = this.jobs.find(job => (ACTIVE_STATES.has(job.state) || this.active.has(job.id))
      && job.url === url
      && String(job.output_directory || '').toLowerCase() === outputDirectory.toLowerCase()
      && (job.subdirectory || null) === subdirectory);
    if (duplicate) return { added: false, duplicate_id: duplicate.id, job: { ...persistedJob(duplicate) } };

    const job = {
      id: this.idFactory(),
      url,
      title: input.title || 'Analyzing URL...',
      thumbnail: input.thumbnail || '',
      output_directory: outputDirectory,
      subdirectory,
      created_time: new Date(this.now()).toISOString(),
      state: JOB_STATES.QUEUED,
      progress_percent: 0,
      downloaded_bytes: 0,
      total_bytes: null,
      speed: null,
      eta: null,
      exact_output_path: null,
      last_error_category: null,
      last_error_message: null,
      retry_count: 0,
      cancel_requested: false
    };
    this.jobs.push(job);
    this._log(job, { event: 'created' });
    this._changed(true);
    this._drain();
    return { added: true, job: { ...persistedJob(job) } };
  }

  enqueueMany(inputs) {
    return inputs.map(input => this.enqueue(input));
  }

  cancel(id, reason = 'user') {
    const job = this.jobs.find(item => item.id === id);
    if (!job || !ACTIVE_STATES.has(job.state)) return false;
    job.cancel_requested = true;
    const control = this.active.get(id);
    if (control?.process?.kill) {
      try { control.process.kill(); } catch (_) {}
    }
    this._transition(job, JOB_STATES.CANCELLED, { cancel_reason: reason });
    return true;
  }

  cancelAll(reason = 'user') {
    return this.jobs.filter(job => ACTIVE_STATES.has(job.state)).map(job => this.cancel(job.id, reason));
  }

  retry(id) {
    const job = this.jobs.find(item => item.id === id);
    if (!job || job.state !== JOB_STATES.FAILED) return false;
    Object.assign(job, {
      state: JOB_STATES.QUEUED,
      progress_percent: 0,
      downloaded_bytes: 0,
      total_bytes: null,
      speed: null,
      eta: null,
      exact_output_path: null,
      last_error_category: null,
      last_error_message: null,
      retry_count: 0,
      cancel_requested: false
    });
    this._log(job, { event: 'manual_retry' });
    this._changed(true);
    this._drain();
    return true;
  }

  clear(states) {
    const removable = new Set(states);
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(job => !removable.has(job.state));
    if (this.jobs.length !== before) this._changed(true);
    return before - this.jobs.length;
  }

  waitForIdle() {
    if (!this.active.size && !this.jobs.some(job => job.state === JOB_STATES.QUEUED)) return Promise.resolve();
    return new Promise(resolve => this.idleResolvers.push(resolve));
  }

  _drain() {
    if (!this.running) return;
    while (this.active.size < this.maxConcurrent) {
      const job = this.jobs.find(item => item.state === JOB_STATES.QUEUED && !this.active.has(item.id));
      if (!job) break;
      const control = { process: null };
      this.active.set(job.id, control);
      void this._run(job, control).finally(() => {
        this.active.delete(job.id);
        this._changed(true);
        this._drain();
        this._resolveIdle();
      });
    }
    this._resolveIdle();
  }

  async _run(job, control) {
    for (;;) {
      if (job.state === JOB_STATES.CANCELLED) return;
      this._transition(job, JOB_STATES.METADATA);
      let result;
      try {
        result = await this.executor(job, {
          setState: state => {
            if (job.state !== JOB_STATES.CANCELLED) this._transition(job, state);
          },
          update: patch => {
            if (job.state === JOB_STATES.CANCELLED) return;
            Object.assign(job, patch);
            const last = this.lastProgressPersist.get(job.id) || 0;
            const persist = this.now() - last >= 1000;
            if (persist) this.lastProgressPersist.set(job.id, this.now());
            this._changed(persist);
          },
          registerProcess: process => { control.process = process; },
          isCancelled: () => job.state === JOB_STATES.CANCELLED || job.cancel_requested
        });
      } catch (error) {
        result = { ok: false, errorMessage: error.message, errorCategory: 'INTERNAL' };
      }

      control.process = null;
      if (job.state === JOB_STATES.CANCELLED || job.cancel_requested) return;
      if (result.ok) {
        this._transition(job, JOB_STATES.VERIFYING);
        if (result.outputPath && this.fileExists(result.outputPath)) {
          job.exact_output_path = result.outputPath;
          this._transition(job, JOB_STATES.DONE, { completion_path: result.outputPath });
        } else {
          this._fail(job, 'VERIFYING', 'Exact output path was not reported or does not exist');
        }
        return;
      }

      const message = safeMessage(result.errorMessage || result.stderr || result.error);
      const category = result.engineFailure ? 'ENGINE' : (result.errorCategory || classifyRetry(message));
      if (category === 'TRANSIENT' && job.retry_count < 1) {
        job.retry_count++;
        Object.assign(job, {
          progress_percent: 0,
          downloaded_bytes: 0,
          total_bytes: null,
          speed: null,
          eta: null
        });
        this._log(job, { event: 'transient_retry', failure_category: category });
        this._changed(true);
        continue;
      }
      this._fail(job, category, message);
      return;
    }
  }

  _fail(job, category, message) {
    job.last_error_category = category;
    job.last_error_message = safeMessage(message);
    this._transition(job, JOB_STATES.FAILED, { failure_category: category });
  }

  _transition(job, state, extra = {}) {
    const previous = job.state;
    job.state = state;
    this._log(job, { event: 'state_transition', from: previous, to: state, ...extra });
    this._changed(true);
  }

  _log(job, fields) {
    this.logger({
      job_id: job.id,
      state: job.state,
      retry_count: job.retry_count,
      ...fields
    });
  }

  _changed(persist) {
    if (persist) this._persist();
    this.emit('jobs', this.list());
  }

  _persist() {
    try {
      this.fileSystem.mkdirSync(path.dirname(this.jobsPath), { recursive: true });
      const tempPath = `${this.jobsPath}.tmp`;
      this.fileSystem.writeFileSync(tempPath, JSON.stringify(this.jobs.map(persistedJob), null, 2), 'utf8');
      this.fileSystem.renameSync(tempPath, this.jobsPath);
    } catch (error) {
      this.logger({ event: 'persist_failed', failure_category: 'PERSISTENCE', message: safeMessage(error.message) });
    }
  }

  _resolveIdle() {
    if (this.active.size || this.jobs.some(job => job.state === JOB_STATES.QUEUED)) return;
    this.idleResolvers.splice(0).forEach(resolve => resolve());
  }
}

module.exports = { ACTIVE_STATES, DownloadManager, JOB_STATES, PROGRESS_PREFIX, classifyRetry, parseYtDlpProgress, safeMessage };
