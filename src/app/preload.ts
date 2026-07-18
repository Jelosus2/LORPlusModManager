import type { PluginDownloadProgress } from "../shared/plugin.js";
import type { IpcApi } from "../shared/ipcApi.js";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const modManagerApi: IpcApi = {
    setupGameLocation: (manualSetup: boolean) => ipcRenderer.invoke("setup:game-location", manualSetup),
    downloadLOPlugin: () => ipcRenderer.invoke("plugin:download"),
    onLOPluginDownloadProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: PluginDownloadProgress) => {
            callback(progress);
        };

        ipcRenderer.on("plugin:download-progress", listener);

        return () => {
            ipcRenderer.removeListener("plugin:download-progress", listener);
        };
    }
} as const;

contextBridge.exposeInMainWorld("app", modManagerApi);
