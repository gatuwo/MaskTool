const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0f172f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function sanitizeBaseName(name) {
  const raw = String(name || '').trim();
  const replaced = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[.\s]+$/g, '');
  return replaced || 'masking-output';
}

function resolveUniqueFilePath(directoryPath, baseName) {
  const safeBase = sanitizeBaseName(baseName);
  let counter = 0;
  while (counter < 10000) {
    const suffix = counter === 0 ? '' : `-${String(counter).padStart(2, '0')}`;
    const candidate = `${safeBase}${suffix}.png`;
    const fullPath = path.join(directoryPath, candidate);
    if (!fs.existsSync(fullPath)) {
      return { fullPath, fileName: candidate };
    }
    counter += 1;
  }
  const fallbackName = `${safeBase}-${Date.now()}.png`;
  return { fullPath: path.join(directoryPath, fallbackName), fileName: fallbackName };
}

ipcMain.handle('desktop:pick-save-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  const directoryPath = result.filePaths[0];
  return {
    ok: true,
    canceled: false,
    directoryPath,
    folderName: path.basename(directoryPath),
  };
});

ipcMain.handle('desktop:save-png-file', async (_event, payload) => {
  try {
    const directoryPath = String(payload?.directoryPath || '');
    const baseName = String(payload?.baseName || 'masking-output');
    const bytes = payload?.bytes;

    if (!directoryPath) {
      return { ok: false, error: '保存先フォルダが未指定です。' };
    }
    if (!bytes || typeof bytes.length !== 'number') {
      return { ok: false, error: '画像データが不正です。' };
    }

    const { fullPath, fileName } = resolveUniqueFilePath(directoryPath, baseName);
    fs.writeFileSync(fullPath, Buffer.from(bytes));

    return {
      ok: true,
      filePath: fullPath,
      fileName,
      folderName: path.basename(directoryPath),
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : '保存に失敗しました。',
    };
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
