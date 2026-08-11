const { app, BrowserWindow, ipcMain, dialog, session, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const {
  FINAL_PATH_PREFIX,
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
const activeProcesses = new Map();

// Dynamic Binary Path Resolver
const binaryPaths = resolveBinaryPaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir: __dirname
});
const { ytdlpPath } = binaryPaths;
const cookiesPath = path.join(app.getPath('userData'), 'cookies.txt');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const logPath = path.join(app.getPath('userData'), 'app_debug.log');

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
  if (failures.length) {
    const details = failures.map(name => `${name}: ${diagnostics[`${name}_status`]} (${diagnostics.errors[name] || 'unknown error'})`);
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
    { label: 'Quit YTD Pro', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setToolTip('YTD Pro v7.1.8');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if(mainWindow) mainWindow.show(); });
}

// IPC Handlers
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('minimize-to-tray', () => {
  mainWindow.hide();
  if (process.platform === 'win32') {
    tray.displayBalloon({ title: 'YTD Pro', content: 'App is still running in the system tray.' });
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

ipcMain.on('cancel-all-downloads', () => {
  logToFile(`Cancelling all downloads: ${activeProcesses.size} active tasks.`);
  activeProcesses.forEach((proc, id) => { try { proc.kill(); } catch(e) {} });
  activeProcesses.clear();
});

ipcMain.handle('get-metadata', async (event, url) => {
  if (!ensureBinaryExists(ytdlpPath)) throw new Error('yt-dlp.exe missing');

  const args = [...buildYtDlpBaseArgs({ paths: binaryPaths, cookiesPath }), '--dump-json'];
  args.push(url);
  const result = await executeWithRecovery({
    operation: () => runProcess(ytdlpPath, args, { env: spawnEnv, timeoutMs: 0 }),
    recover: performSafeUpdate,
    trigger: 'METADATA_FAILURE',
    logger: recoveryLogger
  });
  if (!result.ok) {
    const errorMsg = result.stderr || result.error || 'Unknown error occurred';
    logToFile(`Metadata fetch failed: ${classifyYtDlpFailure(errorMsg).reason}`);
    throw new Error(errorMsg);
  }
  try { return JSON.parse(result.stdout); } catch(e) {
    logToFile('Metadata parse failed: ' + e.message);
    throw new Error('Metadata parse error');
  }
});

ipcMain.handle('get-playlist-data', async (event, url) => {
  if (!ensureBinaryExists(ytdlpPath)) throw new Error('yt-dlp.exe missing');

  // Basic filter for shorts if URL contains /shorts
  const args = [
    ...buildYtDlpBaseArgs({ paths: binaryPaths, cookiesPath }),
    '--flat-playlist', 
    '--dump-json'
  ];
  
  if (url.includes('/shorts')) {
    args.push('--match-filter', 'duration < 65'); // YouTube Shorts are usually under 60s
  }
  
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
    throw new Error(errorMsg);
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

function runDownloadAttempt(event, id, args) {
  return new Promise((resolve) => {
    const subprocess = spawn(ytdlpPath, args, { env: spawnEnv, windowsHide: true });
    activeProcesses.set(id, subprocess);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(id);
      resolve({ stdout, stderr, ...result });
    };

    subprocess.stdout.on('data', (data) => {
      const line = data.toString();
      stdout += line;
      const percentMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      const speedMatch = line.match(/at\s+([\d\.]+\w+\/s)/);
      if (percentMatch) event.sender.send('download-progress', { id, value: parseFloat(percentMatch[1]) });
      if (speedMatch) event.sender.send('download-speed', { id, value: speedMatch[1] });
    });
    subprocess.stderr.on('data', data => { stderr += data.toString(); });
    subprocess.on('error', error => finish({ ok: false, code: null, error: error.message }));
    subprocess.on('close', code => finish({ ok: code === 0, code, error: code === 0 ? null : `Process exited with code ${code}` }));
  });
}

ipcMain.on('download-video', (event, { id, url, savePath, subDir }) => {
  if (!ensureBinaryExists(ytdlpPath)) {
    event.sender.send('download-error', { id, message: 'yt-dlp.exe missing' });
    return;
  }

  let finalSavePath = savePath;
  if (subDir) {
    // Sanitize subDir to prevent path traversal
    const sanitizedSubDir = subDir.replace(/[^\w\s-]/g, '_').replace(/\.{2,}/g, '_');
    finalSavePath = path.join(savePath, sanitizedSubDir);
    if (!fs.existsSync(finalSavePath)) {
      fs.mkdirSync(finalSavePath, { recursive: true });
    }
  }

  // Check Write Permissions
  try {
    fs.accessSync(finalSavePath, fs.constants.W_OK);
  } catch (err) {
    logToFile(`Permission denied: ${finalSavePath}`);
    event.sender.send('download-error', { id, message: `Quyền ghi bị từ chối: ${finalSavePath}` });
    return;
  }

  logToFile(`Download [${id}] to ${finalSavePath}`);
  const args = [
    ...buildYtDlpBaseArgs({ paths: binaryPaths, cookiesPath, ffmpeg: true }),
    '--output', path.join(finalSavePath, '%(title)s.%(ext)s'),
    '--no-part',
    '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--newline', '--progress',
    '--no-simulate', '--print', `after_move:${FINAL_PATH_PREFIX}%(filepath)s`
  ];
  args.push(url);

  void executeWithRecovery({
    operation: () => runDownloadAttempt(event, id, args),
    recover: performSafeUpdate,
    trigger: 'DOWNLOAD_FAILURE',
    logger: recoveryLogger
  }).then(result => {
    if (result.ok) {
      const finalPath = result.stdout.split(/\r?\n/).map(extractFinalPath).filter(Boolean).pop();
      if (finalPath && fs.existsSync(finalPath)) {
        event.sender.send('download-complete', { id, path: finalPath });
      } else {
        logToFile(`yt-dlp did not report a valid final path for download ${id}`);
        event.sender.send('download-error', { id, message: 'Downloaded file path was not reported or does not exist' });
      }
    } else {
      const message = result.stderr.trim().split(/\r?\n/).pop() || result.error || `Process exited with code ${result.code}`;
      logToFile(`Download ${id} failed: ${classifyYtDlpFailure(message).reason}`);
      event.sender.send('download-error', { id, message });
    }
  }).catch(error => {
    logToFile(`Download ${id} failed: internal_error`);
    event.sender.send('download-error', { id, message: error.message });
  });
});

// Cookie Format Conversion (Netscape format)
async function exportCookiesToNetscape() {
  const cookies = await session.defaultSession.cookies.get({ domain: '.youtube.com' });
  let content = '# Netscape HTTP Cookie File\n';
  content += '# http://curl.haxx.se/rfc/cookie_spec.html\n';
  content += '# This is a generated file!  Do not edit.\n\n';

  cookies.forEach(c => {
    const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    const includeSubdomains = 'TRUE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    content += `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expires}\t${c.name}\t${c.value}\n`;
  });

  fs.writeFileSync(cookiesPath, content, 'utf8');
  logToFile(`Cookies exported to ${cookiesPath} (${cookies.length} items)`);
}

ipcMain.handle('login-youtube', async () => {
  return new Promise((resolve, reject) => {
    const loginWin = new BrowserWindow({
      width: 800, height: 600,
      title: 'Login to YouTube',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    loginWin.loadURL('https://youtube.com');
    loginWin.on('closed', async () => {
      try {
        await exportCookiesToNetscape();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

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
ipcMain.handle('get-default-path', () => currentSavePath || app.getPath('downloads'));

app.whenReady().then(async () => {
  if (fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
  if (await validateBinaries()) {
    createTray();
    createWindow();
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
