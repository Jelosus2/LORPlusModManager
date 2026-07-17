import type { IpcApi } from "../shared/ipcApi.js";

import { contextBridge, ipcRenderer } from "electron";

const modManagerApi: IpcApi = {
    setupGameLocation: (manualSetup: boolean) => ipcRenderer.invoke("setup:game-location", manualSetup)
} as const;

contextBridge.exposeInMainWorld("app", modManagerApi);
