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
  getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
  loginYouTube: () => ipcRenderer.invoke('login-youtube'),

  // Download Engine
  getMetadata: (url) => ipcRenderer.invoke('get-metadata', url),
  getPlaylistData: (url) => ipcRenderer.invoke('get-playlist-data', url),
  downloadVideo: (params) => ipcRenderer.send('download-video', params),
  cancelAllDownloads: () => ipcRenderer.send('cancel-all-downloads'),
  
  // Listeners
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onDownloadSpeed: (callback) => ipcRenderer.on('download-speed', (event, data) => callback(data)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),
  onDownloadError: (callback) => ipcRenderer.on('download-error', (event, data) => callback(data)),
  onEngineStatusUpdated: (callback) => ipcRenderer.on('engine-status-updated', (event, data) => callback(data))
});
