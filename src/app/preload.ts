import type { PluginProgress } from "../shared/plugin.js";
import type { IpcApi } from "../shared/ipcApi.js";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const modManagerApi: IpcApi = {
    setupGameLocation: (manualSetup: boolean) => ipcRenderer.invoke("setup:game-location", manualSetup),
    installLOPlugin: () => ipcRenderer.invoke("plugin:install"),
    onLOPluginInstallProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: PluginProgress) => {
            callback(progress);
        };

        ipcRenderer.on("plugin:install-progress", listener);

        return () => {
            ipcRenderer.removeListener("plugin:install-progress", listener);
        };
    },
    getSetupState: () => ipcRenderer.invoke("setup:get-state")
} as const;

contextBridge.exposeInMainWorld("app", modManagerApi);
