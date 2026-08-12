const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  quitApp: () => ipcRenderer.send('app-quit'),

  // Maintenance & Tools
  openHomeDir: () => ipcRenderer.invoke('open-home-dir'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  updateEngine: () => ipcRenderer.invoke('update-engine'),
  repairEngine: () => ipcRenderer.invoke('repair-engine'),
  getEngineStatus: () => ipcRenderer.invoke('get-engine-status'),

  // Storage and Core
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openDownloadFolder: () => ipcRenderer.invoke('open-download-folder'),
  getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
  loginYouTube: () => ipcRenderer.invoke('login-youtube'),
  logoutYouTube: () => ipcRenderer.invoke('logout-youtube'),
  getAuthState: () => ipcRenderer.invoke('get-auth-state'),

  // Download Engine
  getPlaylistData: (url) => ipcRenderer.invoke('get-playlist-data', url),
  enqueueDownloadJobs: (jobs) => ipcRenderer.invoke('enqueue-download-jobs', jobs),
  getDownloadJobs: () => ipcRenderer.invoke('get-download-jobs'),
  cancelDownloadJob: (id) => ipcRenderer.invoke('cancel-download-job', id),
  retryDownloadJob: (id) => ipcRenderer.invoke('retry-download-job', id),
  clearDownloadJobs: (states) => ipcRenderer.invoke('clear-download-jobs', states),
  cancelAllDownloads: () => ipcRenderer.send('cancel-all-downloads'),
  
  // Listeners
  onDownloadJobsUpdated: (callback) => ipcRenderer.on('download-jobs-updated', (event, data) => callback(data)),
  onEngineStatusUpdated: (callback) => ipcRenderer.on('engine-status-updated', (event, data) => callback(data)),
  onAuthStateUpdated: (callback) => ipcRenderer.on('auth-state-updated', (event, data) => callback(data))
});
