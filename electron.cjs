const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'Quiromasajes E.F',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true
    }
  });

  // Permitir micrófono
  win.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(permission === 'media');
    }
  );

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
