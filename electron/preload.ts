import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('ipcRenderer', {
    on: (channel: string, func: (...args: any[]) => void) => {
        const validChannels = ['toggle-dictation', 'switch-to-hud'];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender`
            const subscription = (_event: any, ...args: any[]) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
    },
    send: (channel: string, data?: any) => {
        const validChannels = ['to-main', 'resize-window', 'paste-text', 'hide-hud'];
        if (validChannels.includes(channel)) {
            console.log(`[Preload] Sending to main: ${channel}`, data);
            ipcRenderer.send(channel, data);
        } else {
            console.warn(`[Preload] Blocked unauthorized channel: ${channel}`);
        }
    }
})
