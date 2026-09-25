const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');

let win = null;

// Keep the app from being suspended for the whole of a recording. The
// renderer's recording controller sends 'start' when capture begins and
// 'stop' when it is finalized or discarded.
let powerBlockerId = null;
ipcMain.on('power-blocker', (_event, action) => {
    if (action === 'start' && powerBlockerId === null) {
        powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (action === 'stop' && powerBlockerId !== null) {
        if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
        powerBlockerId = null;
    }
});

// The recorder needs an answer (meeting audio stopped, "Still recording?")
// while the user is in another app: bring the window forward. If the OS
// refuses the focus (Windows focus-stealing rules), flash the taskbar instead.
ipcMain.on('focus-window', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (!win.isFocused()) win.flashFrame(true);
});

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

    win.on('focus', () => {
        if (win) win.flashFrame(false);
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
