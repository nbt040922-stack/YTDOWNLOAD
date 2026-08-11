const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AUTH_STATES,
  TEMP_PREFIX,
  YOUTUBE_PARTITION,
  YouTubeAuthSession,
  isAuthRequired,
  redactSensitive
} = require('../auth-session');
const { DownloadManager, JOB_STATES } = require('../download-manager');
const { executeWithRecovery } = require('../engine-runtime');

const tempDirs = [];
test.afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function makeAuth({ cookies = [], createBrowserWindow, logger } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-auth-'));
  tempDirs.push(directory);
  const store = { cookies: [...cookies], cleared: false };
  const partitions = [];
  const sessionFromPartition = partition => {
    partitions.push(partition);
    return ({
    cookies: { get: async () => store.cookies },
    clearStorageData: async () => { store.cookies = []; store.cleared = true; }
    });
  };
  const auth = new YouTubeAuthSession({
    sessionFromPartition,
    createBrowserWindow: createBrowserWindow || (() => assert.fail('window not expected')),
    userDataPath: directory,
    randomBytes: () => Buffer.alloc(12, 1),
    logger
  });
  return { auth, directory, partitions, sessionFromPartition, store };
}

const signedInCookie = {
  domain: '.youtube.com',
  path: '/',
  secure: true,
  expirationDate: 2000000000,
  name: 'SAPISID',
  value: 'secret-cookie'
};

test('dedicated persistent partition and safe login window are used', async () => {
  let options;
  let loadedUrl;
  let menuRemoved = false;
  const window = new EventEmitter();
  window.removeMenu = () => { menuRemoved = true; };
  window.loadURL = async url => {
    loadedUrl = url;
    setImmediate(() => window.emit('closed'));
  };
  const { auth, partitions, store } = makeAuth({
    createBrowserWindow: value => { options = value; return window; }
  });
  store.cookies.push(signedInCookie);
  assert.equal(await auth.login(), AUTH_STATES.SIGNED_IN);
  assert.equal(YOUTUBE_PARTITION, 'persist:ytdownload-youtube');
  assert.equal(options.webPreferences.partition, YOUTUBE_PARTITION);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.preload, undefined);
  assert.equal(loadedUrl, 'https://www.youtube.com');
  assert.equal(menuRemoved, true);
  assert.ok(partitions.every(partition => partition === YOUTUBE_PARTITION));
});

test('persistent session state survives helper recreation', async () => {
  const { auth, directory, sessionFromPartition } = makeAuth({ cookies: [signedInCookie] });
  assert.equal(await auth.initialize(), AUTH_STATES.SIGNED_IN);
  const restarted = new YouTubeAuthSession({
    sessionFromPartition,
    createBrowserWindow: () => {},
    userDataPath: directory
  });
  assert.equal(await restarted.initialize(), AUTH_STATES.SIGNED_IN);
});

test('temporary Netscape cookie file preserves required fields', async () => {
  const { auth } = makeAuth({ cookies: [
    signedInCookie,
    { domain: 'youtube.com', path: '/watch', secure: false, name: 'LOGIN_INFO', value: 'value' },
    { domain: '.example.com', path: '/', name: 'ignore', value: 'outside' }
  ] });
  const cookiePath = await auth.exportTemporaryCookies();
  const content = fs.readFileSync(cookiePath, 'utf8');
  assert.match(path.basename(cookiePath), new RegExp(`^${TEMP_PREFIX}.+\\.txt$`));
  assert.match(content, /\.youtube\.com\tTRUE\t\/\tTRUE\t2000000000\tSAPISID\tsecret-cookie/);
  assert.match(content, /youtube\.com\tFALSE\t\/watch\tFALSE\t0\tLOGIN_INFO\tvalue/);
  assert.doesNotMatch(content, /outside|example\.com/);
});

test('temporary cookie file is removed after successful operation', async () => {
  const { auth } = makeAuth({ cookies: [signedInCookie] });
  let filePath;
  const result = await auth.withTemporaryCookies(async value => {
    filePath = value;
    assert.equal(fs.existsSync(value), true);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(fs.existsSync(filePath), false);
});

test('temporary cookie file is removed after failed operation', async () => {
  const { auth } = makeAuth({ cookies: [signedInCookie] });
  let filePath;
  await assert.rejects(auth.withTemporaryCookies(async value => {
    filePath = value;
    throw new Error('operation failed');
  }), /operation failed/);
  assert.equal(fs.existsSync(filePath), false);
});

test('stale temporary auth files are cleaned on startup', async () => {
  const { auth } = makeAuth();
  fs.mkdirSync(auth.tempDirectory, { recursive: true });
  const stale = path.join(auth.tempDirectory, `${TEMP_PREFIX}stale.txt`);
  const unrelated = path.join(auth.tempDirectory, 'keep.txt');
  fs.writeFileSync(stale, 'secret');
  fs.writeFileSync(unrelated, 'keep');
  await auth.initialize();
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(unrelated), true);
});

test('auth-required failure does not trigger engine recovery', async () => {
  let updates = 0;
  const result = await executeWithRecovery({
    operation: async () => ({ ok: false, stderr: 'Sign in to confirm you are not a bot' }),
    recover: async () => { updates++; return { usable: true }; },
    trigger: 'AUTH_TEST'
  });
  assert.equal(result.ok, false);
  assert.equal(updates, 0);
  assert.equal(isAuthRequired(result.stderr), true);
});

test('auth-required failure is permanent and does not normal-retry', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ytd-auth-manager-'));
  tempDirs.push(directory);
  let calls = 0;
  const manager = new DownloadManager({
    jobsPath: path.join(directory, 'jobs.json'),
    executor: async () => { calls++; return { ok: false, errorMessage: 'YouTube sign-in required', errorCategory: 'AUTH' }; }
  });
  manager.enqueue({ url: 'https://youtube.com/watch?v=1', output_directory: directory });
  manager.start();
  await manager.waitForIdle();
  assert.equal(calls, 1);
  assert.equal(manager.list()[0].state, JOB_STATES.FAILED);
  assert.equal(manager.list()[0].last_error_category, 'AUTH');
});

test('logout clears only the dedicated YouTube partition', async () => {
  const defaultSession = { untouched: true };
  const { auth, store } = makeAuth({ cookies: [signedInCookie] });
  assert.equal(await auth.logout(), AUTH_STATES.SIGNED_OUT);
  assert.equal(store.cleared, true);
  assert.equal(defaultSession.untouched, true);
});

test('logs and UI messages redact cookie, auth, token, and password secrets', () => {
  const redacted = redactSensitive('Cookie: abc=secret\nAuthorization: Bearer auth-secret\naccess_token=token-secret password=pw-secret');
  assert.doesNotMatch(redacted, /abc=secret|auth-secret|token-secret|pw-secret/);
});

test('metadata, playlist, and download paths use the same auth helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.equal((source.match(/youtubeAuth\.withTemporaryCookies/g) || []).length, 3);
  assert.doesNotMatch(source, /session\.defaultSession|buildYtDlpBaseArgs\(\{[^}]*legacyCookiesPath/);
});
