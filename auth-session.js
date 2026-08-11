const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const YOUTUBE_PARTITION = 'persist:ytdownload-youtube';
const AUTH_STATES = Object.freeze({
  SIGNED_OUT: 'SIGNED_OUT',
  SIGNED_IN: 'SIGNED_IN',
  UNKNOWN: 'UNKNOWN'
});
const TEMP_PREFIX = 'ytd-auth-';
const RELEVANT_DOMAIN = /(^|\.)(youtube\.com|google\.com|googlevideo\.com)$/i;
const AUTH_COOKIE = /^(?:SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|__Secure-[123]P(?:SID|APISID))$/i;

function isRelevantCookie(cookie) {
  return RELEVANT_DOMAIN.test(String(cookie.domain || '').replace(/^\./, ''));
}

function netscapeCookieLine(cookie) {
  const rawDomain = String(cookie.domain || '');
  const domain = `${cookie.httpOnly ? '#HttpOnly_' : ''}${rawDomain}`;
  const includeSubdomains = rawDomain.startsWith('.') ? 'TRUE' : 'FALSE';
  const cookiePath = cookie.path || '/';
  const secure = cookie.secure ? 'TRUE' : 'FALSE';
  const expiration = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
  const clean = value => String(value || '').replace(/[\t\r\n]/g, '');
  return `${domain}\t${includeSubdomains}\t${clean(cookiePath)}\t${secure}\t${expiration}\t${clean(cookie.name)}\t${clean(cookie.value)}`;
}

function isAuthRequired(message) {
  return /login required|sign in to (?:confirm|view)|authentication required|members-only|cookies? (?:are )?required|confirm you(?:'|’)re not a bot/i.test(String(message || ''));
}

function redactSensitive(message) {
  return String(message || '')
    .replace(/(?:set-)?cookie\s*[:=]\s*[^\r\n]+/gi, 'cookie=[REDACTED]')
    .replace(/authorization\s*[:=]\s*[^\r\n]+/gi, 'authorization=[REDACTED]')
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:access|refresh|oauth|session)[_-]?token\s*[:=]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[REDACTED]');
}

class YouTubeAuthSession {
  constructor({
    sessionFromPartition,
    createBrowserWindow,
    userDataPath,
    fileSystem = fs,
    randomBytes = crypto.randomBytes,
    onStateChange = () => {},
    logger = () => {}
  }) {
    this.sessionFromPartition = sessionFromPartition;
    this.createBrowserWindow = createBrowserWindow;
    this.fileSystem = fileSystem;
    this.randomBytes = randomBytes;
    this.onStateChange = onStateChange;
    this.logger = logger;
    this.partition = YOUTUBE_PARTITION;
    this.tempDirectory = path.join(userDataPath, 'tmp');
    this.state = AUTH_STATES.UNKNOWN;
  }

  get session() {
    return this.sessionFromPartition(this.partition);
  }

  async initialize() {
    try {
      this.cleanupStaleTempFiles();
      return await this.refreshState();
    } catch (error) {
      this.logger({ event: 'auth_initialize_failed', message: redactSensitive(error.message) });
      return this._setState(AUTH_STATES.UNKNOWN);
    }
  }

  async refreshState() {
    try {
      const cookies = await this.session.cookies.get({});
      const signedIn = cookies.some(cookie => isRelevantCookie(cookie) && AUTH_COOKIE.test(cookie.name));
      return this._setState(signedIn ? AUTH_STATES.SIGNED_IN : AUTH_STATES.SIGNED_OUT);
    } catch (error) {
      this.logger({ event: 'auth_state_failed', message: redactSensitive(error.message) });
      return this._setState(AUTH_STATES.UNKNOWN);
    }
  }

  async login() {
    const loginWindow = this.createBrowserWindow({
      width: 800,
      height: 600,
      title: 'Login to YouTube',
      webPreferences: {
        partition: this.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    loginWindow.removeMenu?.();
    await loginWindow.loadURL('https://www.youtube.com');
    return new Promise(resolve => {
      loginWindow.once('closed', async () => resolve(await this.refreshState()));
    });
  }

  async logout() {
    await this.session.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
    });
    this.cleanupStaleTempFiles();
    return this._setState(AUTH_STATES.SIGNED_OUT);
  }

  async exportTemporaryCookies() {
    const cookies = (await this.session.cookies.get({})).filter(isRelevantCookie);
    if (!cookies.length) return null;
    this.fileSystem.mkdirSync(this.tempDirectory, { recursive: true });
    const filePath = path.join(this.tempDirectory, `${TEMP_PREFIX}${this.randomBytes(12).toString('hex')}.txt`);
    const content = ['# Netscape HTTP Cookie File', ...cookies.map(netscapeCookieLine), ''].join('\n');
    this.fileSystem.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return filePath;
  }

  async withTemporaryCookies(operation) {
    let cookiePath = null;
    try {
      cookiePath = await this.exportTemporaryCookies();
      return await operation(cookiePath);
    } finally {
      if (cookiePath) {
        try { this.fileSystem.unlinkSync(cookiePath); } catch (_) {}
      }
    }
  }

  cleanupStaleTempFiles() {
    if (!this.fileSystem.existsSync(this.tempDirectory)) return 0;
    let removed = 0;
    for (const entry of this.fileSystem.readdirSync(this.tempDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(TEMP_PREFIX) || !entry.name.endsWith('.txt')) continue;
      try {
        this.fileSystem.unlinkSync(path.join(this.tempDirectory, entry.name));
        removed++;
      } catch (_) {}
    }
    return removed;
  }

  _setState(state) {
    this.state = state;
    this.onStateChange(state);
    return state;
  }
}

module.exports = {
  AUTH_STATES,
  TEMP_PREFIX,
  YOUTUBE_PARTITION,
  YouTubeAuthSession,
  isAuthRequired,
  isRelevantCookie,
  netscapeCookieLine,
  redactSensitive
};
