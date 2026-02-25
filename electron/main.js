const { app, BrowserWindow } = require('electron');
const path = require('path');

let win = null;

function createMainWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
        },
        titleBarStyle: 'hiddenInset',
        show: false,
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    win.once('ready-to-show', () => {
        if (win) win.show();
    });

    win.on('close', (event) => {
        if (!app.isQuiting) {
            event.preventDefault();
            if (win) win.hide();
        }
        return false;
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
        win = null;
    }
});

app.isQuiting = false;

app.on('before-quit', () => {
    app.isQuiting = true;
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.disableHardwareAcceleration();

app.whenReady().then(createMainWindow);
