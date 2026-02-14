"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on: (channel, func) => {
    const validChannels = ["toggle-dictation", "switch-to-hud"];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => func(...args);
      electron.ipcRenderer.on(channel, subscription);
      return () => {
        electron.ipcRenderer.removeListener(channel, subscription);
      };
    }
  },
  send: (channel, data) => {
    const validChannels = ["to-main", "resize-window", "paste-text", "hide-hud"];
    if (validChannels.includes(channel)) {
      console.log(`[Preload] Sending to main: ${channel}`, data);
      electron.ipcRenderer.send(channel, data);
    } else {
      console.warn(`[Preload] Blocked unauthorized channel: ${channel}`);
    }
  }
});
