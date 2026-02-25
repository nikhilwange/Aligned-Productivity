import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
    on: (channel: string, func: (...args: any[]) => void) => {
        const validChannels: string[] = [];
        if (validChannels.includes(channel)) {
            const subscription = (_event: any, ...args: any[]) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
    },
    send: (channel: string, data?: any) => {
        const validChannels = ['to-main', 'resize-window'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    }
})
