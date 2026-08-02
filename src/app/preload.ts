import type { ModImportProgress, ModSyncProgress } from "../shared/mod.js";
import type { GameLocationChangeProgress } from "../shared/setup.js";
import type { PluginProgress } from "../shared/plugin.js";
import type { IpcApi } from "../shared/ipcApi.js";

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const modManagerApi: IpcApi = {
    setupGameLocation: (manualSetup) => ipcRenderer.invoke("setup:game-location", manualSetup),
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
    getSetupState: () => ipcRenderer.invoke("setup:get-state"),
    getCharacterCatalog: () => ipcRenderer.invoke("characters:get-catalog"),
    selectModSources: (mode) => ipcRenderer.invoke("mod:select-sources", mode),
    extractMods: (request) => ipcRenderer.invoke("mod:extract", request),
    getMods: () => ipcRenderer.invoke("mod:get-all"),
    openModFolder: (modId) => ipcRenderer.invoke("mod:open-folder", modId),
    deleteMod: (modId) => ipcRenderer.invoke("mod:delete", modId),
    renameMod: (request) => ipcRenderer.invoke("mod:rename", request),
    deleteMods: (modIds) => ipcRenderer.invoke("mod:delete-many", modIds),
    onModImportProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: ModImportProgress) => {
            callback(progress);
        };

        ipcRenderer.on("mod:import-progress", listener);

        return () => {
            ipcRenderer.removeListener("mod:import-progress", listener);
        };
    },
    recoverInterruptedModOperations: () => ipcRenderer.invoke("mod:startup-recover"),
    hasAdminPrivileges: () => ipcRenderer.invoke("app:has-admin-privileges"),
    syncMods: (request) => ipcRenderer.invoke("mod:sync", request),
    onModSyncProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: ModSyncProgress) => {
            callback(progress);
        };

        ipcRenderer.on("mod:sync-progress", listener);

        return () => {
            ipcRenderer.removeListener("mod:sync-progress", listener);
        };
    },
    openRecoveryFolder: () => ipcRenderer.invoke("app:open-recovery-folder"),
    selectGameLocation: (manualSetup) => ipcRenderer.invoke("setup:select-game-location", manualSetup),
    changeGameLocation: (gameLocation) => ipcRenderer.invoke("setup:change-game-location", gameLocation),
    onGameLocationChangeProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: GameLocationChangeProgress) => {
            callback(progress);
        };

        ipcRenderer.on("setup:game-location-change-progress", listener);

        return () => {
            ipcRenderer.removeListener("setup:game-location-change-progress", listener);
        };
    },
    openGameLocation: () => ipcRenderer.invoke("setup:open-game-location"),
    getUpdateSettings: () => ipcRenderer.invoke("updates:get-settings"),
    setAutomaticUpdatePreference: (request) => ipcRenderer.invoke("updates:set-automatic-preference", request),
    checkForUpdates: (mode) => ipcRenderer.invoke("updates:check", mode)
} as const;

contextBridge.exposeInMainWorld("app", modManagerApi);
