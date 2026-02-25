"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on: (channel, func) => {
    const validChannels = [];
    if (validChannels.includes(channel)) {
      const subscription = (_event, ...args) => func(...args);
      electron.ipcRenderer.on(channel, subscription);
      return () => {
        electron.ipcRenderer.removeListener(channel, subscription);
      };
    }
  },
  send: (channel, data) => {
    const validChannels = ["to-main", "resize-window"];
    if (validChannels.includes(channel)) {
      electron.ipcRenderer.send(channel, data);
    }
  }
});
