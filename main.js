const { app, BrowserWindow, ipcMain, dialog, session, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { DownloadManager, JOB_STATES, PROGRESS_PREFIX, parseYtDlpProgress } = require('./download-manager');
const { YouTubeAuthSession, isAuthRequired, redactSensitive } = require('./auth-session');
const {
  FINAL_PATH_PREFIX,
  bootstrapRuntime,
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
  updateLogRecord
} = require('./engine-runtime');

let mainWindow;
let tray = null;
let latestDiagnostics = null;
let updateInFlight = null;
let downloadManager = null;
let youtubeAuth = null;
const MAX_CONCURRENT_DOWNLOADS = 2;

// Dynamic Binary Path Resolver
const binaryPaths = resolveBinaryPaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir: __dirname,
  userDataPath: app.getPath('userData')
});
const { ytdlpPath } = binaryPaths;
const legacyCookiesPath = path.join(app.getPath('userData'), 'cookies.txt');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const logPath = path.join(app.getPath('userData'), 'app_debug.log');
const jobsPath = path.join(app.getPath('userData'), 'download-jobs.json');

const spawnEnv = { ...process.env };

// Persistent Settings Manager
function getSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (e) {
    logToFile('Error reading settings.json: ' + e.message);
  }
  return { savePath: app.getPath('downloads') };
}

function saveSettings(settings) {
  try {
    const merged = { ...getSettings(), ...settings };
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (e) {
    logToFile('Error saving settings.json: ' + e.message);
    return settings;
  }
}

// Global Save Path Initialization
let currentSavePath = getSettings().savePath;

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logPath, logEntry, 'utf8');
}

// Verification & Startup
async function validateBinaries() {
  const diagnostics = await runEngineDiagnostics(binaryPaths, spawnEnv);
  latestDiagnostics = diagnostics;
  logToFile('Engine diagnostics: ' + JSON.stringify(diagnostics));
  const failures = ['ytdlp', 'deno', 'ffmpeg'].filter(name => diagnostics[`${name}_status`] !== 'ok');
  const fallbackFailures = ['ytdlp', 'deno', 'ffmpeg'].filter(name => diagnostics[`fallback_${name}_status`] !== 'ok');
  if (failures.length || fallbackFailures.length) {
    const details = [
      ...failures.map(name => `runtime ${name}: ${diagnostics[`${name}_status`]} (${diagnostics.errors[name] || 'unknown error'})`),
      ...fallbackFailures.map(name => `fallback ${name}: ${diagnostics[`fallback_${name}_status`]} (${diagnostics.fallback_errors[name] || 'unknown error'})`)
    ];
    dialog.showErrorBox('System Check Failed', details.join('\n'));
    return false;
  }
  return true;
}

function logUpdateResult(result) {
  logToFile('yt-dlp update: ' + JSON.stringify(updateLogRecord(result)));
}

function notifyEngineStatus() {
  if (mainWindow && !mainWindow.isDestroyed() && latestDiagnostics) {
    mainWindow.webContents.send('engine-status-updated', latestDiagnostics);
  }
}

function notifyAuthState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth-state-updated', state);
  }
}

function performSafeUpdate(trigger) {
  if (!updateInFlight) {
    updateInFlight = safeUpdateYtDlp(binaryPaths, { env: spawnEnv, trigger })
      .finally(() => { updateInFlight = null; });
  }
  return updateInFlight;
}

function recoveryLogger(record) {
  logToFile('Auto-recovery: ' + JSON.stringify(record));
}

function ensureBinaryExists(filePath) {
  if (!fs.existsSync(filePath)) {
    dialog.showErrorBox('Binary Not Found', `Critical file missing: ${path.basename(filePath)}\nPath: ${filePath}`);
    return false;
  }
  return true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1020, height: 760, minWidth: 950, minHeight: 650,
    frame: false, backgroundColor: '#202124', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Tray Integration
function createTray() {
  const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'mascot.png')
    : path.join(__dirname, 'resources', 'mascot.png');

  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => { if(mainWindow) mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Quit YTDOWNLOAD', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setToolTip('YTDOWNLOAD v1.0.0');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if(mainWindow) mainWindow.show(); });
}

// IPC Handlers
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('minimize-to-tray', () => {
  mainWindow.hide();
  if (process.platform === 'win32') {
    tray.displayBalloon({ title: 'YTDOWNLOAD', content: 'App is still running in the system tray.' });
  }
});
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());
ipcMain.on('app-quit', () => { app.isQuiting = true; app.quit(); });

ipcMain.handle('open-home-dir', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('open-external', (event, url) => shell.openExternal(url));

ipcMain.handle('update-engine', async () => {
  logToFile('Checking for engine updates...');
  const result = await performSafeUpdate('MANUAL');
  logUpdateResult(result);
  latestDiagnostics = await runEngineDiagnostics(binaryPaths, spawnEnv);
  notifyEngineStatus();
  return result;
});

ipcMain.handle('repair-engine', async () => {
  const result = await repairYtDlp(binaryPaths, { env: spawnEnv });
  logUpdateResult(result);
  latestDiagnostics = result.diagnostics;
  notifyEngineStatus();
  return result;
});

ipcMain.handle('get-engine-status', () => latestDiagnostics);
ipcMain.handle('get-auth-state', () => youtubeAuth?.state || 'UNKNOWN');
ipcMain.handle('login-youtube', () => youtubeAuth.login());
ipcMain.handle('logout-youtube', () => youtubeAuth.logout());

ipcMain.on('cancel-all-downloads', () => {
  downloadManager?.cancelAll('user');
});

async function fetchMetadata(url) {
  if (!ensureBinaryExists(ytdlpPath)) throw new Error('yt-dlp.exe missing');
  return youtubeAuth.withTemporaryCookies(async cookiesPath => {
    const args = [...buildYtDlpBaseArgs({ paths: binaryPaths, cookiesPath }), '--dump-json', url];
    const result = await executeWithRecovery({
      operation: () => runProcess(ytdlpPath, args, { env: spawnEnv, timeoutMs: 0 }),
      recover: performSafeUpdate,
      trigger: 'METADATA_FAILURE',
      logger: recoveryLogger
    });
    if (!result.ok) {
      const errorMsg = result.stderr || result.error || 'Unknown error occurred';
      logToFile(`Metadata fetch failed: ${classifyYtDlpFailure(errorMsg).reason}`);
      const error = new Error(isAuthRequired(errorMsg) ? 'YouTube sign-in required' : errorMsg);
      error.authRequired = isAuthRequired(errorMsg);
      error.engineFailure = Boolean(result.recovery && result.recovery.update_status !== 'NOT_CHECKED');
      throw error;
    }
    try { return JSON.parse(result.stdout); } catch(e) {
      logToFile('Metadata parse failed: ' + e.message);
      throw new Error('Metadata parse error');
    }
  });
}

ipcMain.handle('get-playlist-data', async (event, url) => {
  if (!ensureBinaryExists(ytdlpPath)) throw new Error('yt-dlp.exe missing');
  return youtubeAuth.withTemporaryCookies(async cookiesPath => {
    const args = [...buildYtDlpBaseArgs({ paths: binaryPaths, cookiesPath }), '--flat-playlist', '--dump-json'];
    if (url.includes('/shorts')) args.push('--match-filter', 'duration < 65');
    args.push(url);

    const result = await executeWithRecovery({
      operation: () => runProcess(ytdlpPath, args, { env: spawnEnv, timeoutMs: 0 }),
      recover: performSafeUpdate,
      trigger: 'PLAYLIST_FAILURE',
      logger: recoveryLogger
    });
    if (!result.ok) {
      const errorMsg = result.stderr || result.error || 'Unknown error occurred';
      logToFile(`Playlist fetch failed: ${classifyYtDlpFailure(errorMsg).reason}`);
      throw new Error(isAuthRequired(errorMsg) ? 'YouTube sign-in required' : errorMsg);
    }
    try {
      return result.stdout.trim().split('\n').map(line => {
        const data = JSON.parse(line);
        return {
          id: data.id,
          title: data.title,
          url: data.url || `https://www.youtube.com/watch?v=${data.id}`,
          duration: data.duration,
          thumbnail: data.thumbnails ? data.thumbnails[0].url : (data.thumbnail || ''),
          uploader: data.uploader || 'YouTube'
        };
      });
    } catch(e) {
      logToFile('Parse error in get-playlist-data: ' + e.message);
      throw new Error('Playlist metadata parse error');
    }
  });
});

function runManagedDownloadProcess(job, args, context) {
  return new Promise((resolve) => {
    const subprocess = spawn(ytdlpPath, args, { env: spawnEnv, windowsHide: true });
    context.registerProcess(subprocess);
    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, ...result });
    };

    const handleLine = line => {
      const progress = parseYtDlpProgress(line);
      if (progress) context.update(progress);
      if (/^\[(?:Merger|VideoRemuxer|Fixup)/.test(line)) context.setState(JOB_STATES.MERGING);
    };
    const consume = (chunk, isStderr) => {
      const text = chunk.toString();
      if (isStderr) {
        stderr += text;
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop();
        lines.forEach(handleLine);
      } else {
        stdout += text;
        stdoutBuffer += text;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop();
        lines.forEach(handleLine);
      }
    };
    subprocess.stdout.on('data', data => consume(data, false));
    subprocess.stderr.on('data', data => consume(data, true));
    subprocess.on('error', error => finish({ ok: false, code: null, error: error.message }));
    subprocess.on('close', code => {
      if (stdoutBuffer) handleLine(stdoutBuffer);
      if (stderrBuffer) handleLine(stderrBuffer);
      finish({ ok: code === 0, code, error: code === 0 ? null : `Process exited with code ${code}` });
    });
  });
}

async function executeDownloadJob(job, context) {
  if (!ensureBinaryExists(ytdlpPath)) {
    return { ok: false, errorMessage: 'yt-dlp.exe missing', errorCategory: 'PERMANENT' };
  }

  try {
    const metadata = await fetchMetadata(job.url);
    context.update({ title: metadata.title || job.title, thumbnail: metadata.thumbnail || job.thumbnail });
  } catch (error) {
    if (error.authRequired || isAuthRequired(error.message)) {
      return { ok: false, errorMessage: 'YouTube sign-in required', errorCategory: 'AUTH' };
    }
    const failure = classifyYtDlpFailure(error.message);
    return { ok: false, errorMessage: error.message, engineFailure: error.engineFailure || failure.recoverable };
  }
  if (context.isCancelled()) return { ok: false, cancelled: true };

  let finalSavePath = job.output_directory;
  if (job.subdirectory) {
    const sanitizedSubDir = job.subdirectory.replace(/[^\w\s-]/g, '_').replace(/\.{2,}/g, '_');
    finalSavePath = path.join(finalSavePath, sanitizedSubDir);
  }
  try {
    fs.mkdirSync(finalSavePath, { recursive: true });
    fs.accessSync(finalSavePath, fs.constants.W_OK);
  } catch (error) {
    return { ok: false, errorMessage: `Không thể ghi vào thư mục: ${finalSavePath}`, errorCategory: 'PERMANENT' };
  }

  context.setState(JOB_STATES.DOWNLOADING);
  const result = await youtubeAuth.withTemporaryCookies(async cookiesPath => {
    const args = [
      ...buildYtDlpBaseArgs({ paths: binaryPaths, cookiesPath, ffmpeg: true }),
      '--output', path.join(finalSavePath, '%(title)s.%(ext)s'),
      '--no-part',
      '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--newline', '--progress',
      '--progress-template', `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
      '--no-simulate', '--print', `after_move:${FINAL_PATH_PREFIX}%(filepath)s`,
      job.url
    ];
    return executeWithRecovery({
      operation: () => runManagedDownloadProcess(job, args, context),
      recover: performSafeUpdate,
      trigger: 'DOWNLOAD_FAILURE',
      logger: recoveryLogger
    });
  });
  if (!result.ok) {
    if (context.isCancelled()) return { ok: false, cancelled: true };
    const fullMessage = result.stderr || result.error || `Process exited with code ${result.code}`;
    if (isAuthRequired(fullMessage)) {
      return { ok: false, errorMessage: 'YouTube sign-in required', errorCategory: 'AUTH' };
    }
    const message = result.stderr?.trim().split(/\r?\n/).pop() || result.error || `Process exited with code ${result.code}`;
    const engineRecoveryUsed = Boolean(result.recovery && result.recovery.update_status !== 'NOT_CHECKED');
    return { ok: false, errorMessage: message, engineFailure: engineRecoveryUsed || classifyYtDlpFailure(message).recoverable };
  }
  const outputPath = result.stdout.split(/\r?\n/).map(extractFinalPath).filter(Boolean).pop();
  return { ok: true, outputPath };
}

ipcMain.handle('enqueue-download-jobs', (event, jobs) => downloadManager.enqueueMany(jobs));
ipcMain.handle('get-download-jobs', () => downloadManager?.list() || []);
ipcMain.handle('cancel-download-job', (event, id) => downloadManager.cancel(id, 'user'));
ipcMain.handle('retry-download-job', (event, id) => downloadManager.retry(id));
ipcMain.handle('clear-download-jobs', (event, states) => downloadManager.clear(states));

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { 
    properties: ['openDirectory', 'createDirectory'], 
    defaultPath: currentSavePath || app.getPath('downloads') 
  });
  
  if (!result.canceled && result.filePaths[0]) {
    const newPath = result.filePaths[0];
    currentSavePath = newPath;
    saveSettings({ savePath: newPath });
    return newPath;
  }
  return null;
});
ipcMain.handle('open-download-folder', async () => {
  const folderPath = currentSavePath || app.getPath('downloads');
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    const error = await shell.openPath(folderPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
ipcMain.handle('get-default-path', () => currentSavePath || app.getPath('downloads'));

app.whenReady().then(async () => {
  if (fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
  const bootstrap = await bootstrapRuntime(binaryPaths, { run: runProcess, env: spawnEnv });
  logToFile('Runtime bootstrap: ' + JSON.stringify(bootstrap));
  youtubeAuth = new YouTubeAuthSession({
    sessionFromPartition: partition => session.fromPartition(partition, { cache: true }),
    createBrowserWindow: options => new BrowserWindow({ ...options, parent: mainWindow || undefined }),
    userDataPath: app.getPath('userData'),
    onStateChange: notifyAuthState,
    logger: record => logToFile(`Auth: ${redactSensitive(JSON.stringify(record))}`)
  });
  await youtubeAuth.initialize();
  if (fs.existsSync(legacyCookiesPath)) {
    logToFile('Legacy cookies.txt retained but disabled; dedicated YouTube session is primary.');
  }
  if (await validateBinaries()) {
    downloadManager = new DownloadManager({
      jobsPath,
      executor: executeDownloadJob,
      maxConcurrent: MAX_CONCURRENT_DOWNLOADS,
      logger: record => logToFile(`Download job: ${JSON.stringify(record)}`)
    });
    downloadManager.load();
    downloadManager.on('jobs', jobs => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-jobs-updated', jobs);
      }
    });
    createTray();
    createWindow();
    downloadManager.start();
    void periodicUpdateCheck({
      settings: getSettings(),
      saveSettings,
      paths: binaryPaths,
      update: (paths, { trigger }) => performSafeUpdate(trigger)
    }).then(async result => {
      logUpdateResult(result);
      if (result.update_status !== 'NOT_CHECKED') {
        latestDiagnostics = await runEngineDiagnostics(binaryPaths, spawnEnv);
        notifyEngineStatus();
      }
    }).catch(() => {
      logToFile('Periodic yt-dlp update: UPDATE_FAILED_USABLE');
    });
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
