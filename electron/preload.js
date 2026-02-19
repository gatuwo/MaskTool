const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  isDesktop: true,
  platform: process.platform,
  pickSaveDirectory: () => ipcRenderer.invoke('desktop:pick-save-directory'),
  savePngFile: (payload) => ipcRenderer.invoke('desktop:save-png-file', payload),
});
