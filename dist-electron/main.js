import { app, globalShortcut, BrowserWindow, screen, ipcMain, clipboard } from "electron";
import path from "path";
import { fileURLToPath } from "url";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname$1, "../public");
let win;
let hudWin;
function createMainWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    titleBarStyle: "hiddenInset",
    show: false
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
  }
  win.once("ready-to-show", () => {
    win == null ? void 0 : win.show();
  });
  win.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      win == null ? void 0 : win.hide();
    }
    return false;
  });
}
function createHudWindow() {
  hudWin = new BrowserWindow({
    title: "HUD",
    width: 600,
    height: 120,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    focusable: true,
    // Ensure window can receive focus
    acceptFirstMouse: true
    // Accept mouse events immediately
  });
  const hudUrl = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}?mode=hud` : `file://${path.join(process.env.DIST, "index.html")}?mode=hud`;
  hudWin.loadURL(hudUrl);
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
  hudWin.setPosition(Math.round((screenW - 600) / 2), Math.round(screenH - 150));
  hudWin.on("closed", () => {
    hudWin = null;
  });
}
function hideHudNow() {
  console.log("[Main] 🟢 hideHudNow called");
  if (hudWin && !hudWin.isDestroyed()) {
    console.log("[Main] 🟢 Hiding HUD window");
    hudWin.hide();
  }
  console.log("[Main] 🟢 HUD hidden successfully");
}
function createWindows() {
  createMainWindow();
  createHudWindow();
  console.log("Registering global shortcuts...");
  try {
    const ret1 = globalShortcut.register("Option+Space", () => {
      console.log("Global shortcut Option+Space triggered");
      toggleHud();
    });
    console.log("Option+Space registered:", ret1);
    const ret2 = globalShortcut.register("Command+Shift+0", () => {
      console.log("Global shortcut Command+Shift+0 triggered");
      toggleHud();
    });
    console.log("Command+Shift+0 registered:", ret2);
  } catch (err) {
    console.error("Failed to register shortcut", err);
  }
  function toggleHud() {
    if (!hudWin || hudWin.isDestroyed()) {
      const allWindows = BrowserWindow.getAllWindows();
      const existing = allWindows.find((w) => w.getTitle() === "HUD");
      if (existing) {
        hudWin = existing;
      } else {
        console.log("HUD window not found, recreating...");
        createHudWindow();
        setTimeout(() => toggleHud(), 100);
        return;
      }
    }
    if (!hudWin.isVisible()) {
      console.log("Showing HUD...");
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
      hudWin.setPosition(Math.round((screenW - 600) / 2), Math.round(screenH - 150));
      hudWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      hudWin.show();
      hudWin.focus();
      hudWin.webContents.focus();
      hudWin.webContents.send("toggle-dictation", "start");
    } else {
      console.log("Hiding HUD (Toggle Off via shortcut)...");
      hudWin.webContents.send("toggle-dictation", "stop");
    }
  }
  ipcMain.on("paste-text", (event, text) => {
    console.log("🟢 [Main] paste-text IPC RECEIVED (Option A: Clipboard Only)");
    console.log("🟢 [Main] Text length:", (text == null ? void 0 : text.length) || 0);
    hideHudNow();
    if (text && text.length > 0) {
      console.log("🟢 [Main] Writing to clipboard...");
      clipboard.writeText(text);
      console.log("🟢 [Main] ✅ Text written to clipboard. Skipping AppleScript paste.");
    }
  });
  ipcMain.on("hide-hud", () => {
    console.log("[Main] hide-hud received");
    hideHudNow();
  });
  ipcMain.on("resize-window", (event, { width, height, mode }) => {
    console.log("Resize request ignored");
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.isQuiting = false;
app.on("before-quit", () => {
  app.isQuiting = true;
  globalShortcut.unregisterAll();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindows();
  }
});
app.disableHardwareAcceleration();
app.whenReady().then(createWindows);
