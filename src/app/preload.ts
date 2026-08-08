import type { CatalogIconRepairProgress, CatalogBackgroundRepairProgress } from "../shared/characters.js";
import type { ApplicationUpdateDownloadProgress } from "../shared/updates.js";
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
    checkForUpdates: (mode) => ipcRenderer.invoke("updates:check", mode),
    downloadApplicationUpdate: () => ipcRenderer.invoke("updates:download-application"),
    onApplicationUpdateDownloadProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: ApplicationUpdateDownloadProgress) => {
            callback(progress);
        };

        ipcRenderer.on("updates:application-download-progress", listener);

        return () => {
            ipcRenderer.removeListener("updates:application-download-progress", listener);
        };
    },
    installApplicationUpdate: () => ipcRenderer.invoke("updates:install-application"),
    updateCharacterCatalog: () => ipcRenderer.invoke("updates:install-catalog"),
    repairCatalogIcons: () => ipcRenderer.invoke("updates:repair-catalog-icons"),
    onCatalogIconRepairProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: CatalogIconRepairProgress) => {
            callback(progress);
        };

        ipcRenderer.on("updates:catalog-icon-repair-progress", listener);

        return () => {
            ipcRenderer.removeListener("updates:catalog-icon-repair-progress", listener);
        };
    },
    getModLibraryStorage: () => ipcRenderer.invoke("app:get-mod-library-storage"),
    openModLibraryFolder: () => ipcRenderer.invoke("app:open-mod-library-folder"),
    cleanTemporaryFiles: () => ipcRenderer.invoke("app:clean-temporary-files"),
    openLogFolder: () => ipcRenderer.invoke("app:open-log-folder"),
    getApplicationInfo: () => ipcRenderer.invoke("app:get-application-info"),
    openExternalPage: (page) => ipcRenderer.invoke("app:open-external-page", page),
    getApplicationLogs: () => ipcRenderer.invoke("app:get-application-logs"),
    writeApplicationLog: (request) => ipcRenderer.invoke("app:write-application-log", request),
    getLOPluginConfiguration: () => ipcRenderer.invoke("plugin:get-configuration"),
    saveLOPluginConfiguration: (request) => ipcRenderer.invoke("plugin:save-configuration", request),
    launchGame: (request) => ipcRenderer.invoke("game:launch", request),
    repairCatalogBackgrounds: () => ipcRenderer.invoke("updates:repair-catalog-backgrounds"),
    onCatalogBackgroundRepairProgress: (callback) => {
        const listener = (_event: IpcRendererEvent, progress: CatalogBackgroundRepairProgress) => {
            callback(progress);
        };

        ipcRenderer.on("updates:catalog-background-repair-progress", listener);

        return () => {
            ipcRenderer.removeListener("updates:catalog-background-repair-progress", listener);
        };
    },
    prepareStaticModPreview: (modId) => ipcRenderer.invoke("mod:prepare-static-preview", modId)
} as const;

contextBridge.exposeInMainWorld("app", modManagerApi);
