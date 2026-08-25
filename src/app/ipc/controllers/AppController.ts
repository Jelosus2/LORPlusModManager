import type { ApplicationInfo, ExternalApplicationPage, ApplicationLogEntry } from "../../../shared/application.js";
import type { ModLibraryStorageSummary, ModPreviewCacheStorageSummary } from "../../../shared/mod.js";
import type { TemporaryFileCleanupResult } from "../../../shared/maintenance.js";

import { temporaryFileCleanupService } from "#maintenance/TemporaryFileCleanupService.js";
import { modPreviewCacheStorageService } from "#mod/ModPreviewCacheStorageService.js";
import { modLibraryStorageService } from "#mod/ModLibraryStorageService.js";
import { AdminPrivilegeService } from "#utils/AdminPrivilegeService.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { app, shell, type IpcMainInvokeEvent } from "electron";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { Paths } from "#utils/Paths.js";
import fse from "fs-extra";

export class AppController {
    @IpcHelper.IpcHandle("app:has-admin-privileges")
    hasAdminPrivileges(): Promise<boolean> {
        return AdminPrivilegeService.hasAdminPrivileges();
    }

    @IpcHelper.IpcHandle("app:open-recovery-folder")
    async openRecoveryFolder() {
        return this.openModsFolder("The recovery folder could not be opened.");
    }

    @IpcHelper.IpcHandle("app:get-mod-library-storage")
    async getModLibraryStorage(): Promise<ModLibraryStorageSummary> {
        try
        {
            return await modLibraryStorageService.getSummary();
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The mod library storage usage could not be calculated.", error);
        }
    }

    @IpcHelper.IpcHandle("app:get-mod-preview-cache-storage")
    async getModPreviewCacheStorage(): Promise<ModPreviewCacheStorageSummary> {
        try
        {
            return await modPreviewCacheStorageService.getSummary();
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The mod preview cache storage usage could not be calculated.", error);
        }
    }

    @IpcHelper.IpcHandle("app:delete-mod-preview-cache")
    async deleteModPreviewCache(): Promise<ModPreviewCacheStorageSummary> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.maintenance, "Mod preview cache deletion");

        try
        {
            const result = await modPreviewCacheStorageService.delete();
            operation.complete();

            return result;
        }
        catch (error)
        {
            const contextualError = ErrorUtils.withContext(
                "The mod preview cache could not be deleted.",
                error,
                "Windows could not remove the mod preview cache."
            );

            operation.fail(contextualError);
            throw contextualError;
        }
    }

    @IpcHelper.IpcHandle("app:open-mod-library-folder")
    openModLibraryFolder() {
        return this.openModsFolder("The mod library folder could not be opened.");
    }

    @IpcHelper.IpcHandle("app:clean-temporary-files")
    async cleanTemporaryFiles(): Promise<TemporaryFileCleanupResult> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.maintenance, "Temporary file cleanup");

        try
        {
            const result = await temporaryFileCleanupService.clean();

            if (result.failedLocations > 0)
                operation.completeWithWarnings(result);
            else
                operation.complete(result);

            return result;
        }
        catch (error)
        {
            const contextualError = ErrorUtils.withContext(
                "The temporary files could not be cleaned.",
                error,
                "Windows could not remove the temporary files."
            );

            operation.fail(contextualError);
            throw contextualError;
        }
    }

    @IpcHelper.IpcHandle("app:open-log-folder")
    openLogFolder() {
        return this.openDirectory(Paths.getLogsPath(), "The application log folder could not be opened.");
    }

    @IpcHelper.IpcHandle("app:open-current-log-file-path")
    async openCurrentLogFilePath() {
        try
        {
            const logFilePath = ApplicationLogger.getCurrentLogFilePath();
            if (!await fse.exists(logFilePath))
                throw new Error("The current session log file does not exist.");

            shell.showItemInFolder(logFilePath);
        }
        catch (error)
        {
            throw ErrorUtils.withContext(
                "The current session log file could not be shown.",
                error,
                "Windows could not reveal the current session log file."
            );
        }
    }

    @IpcHelper.IpcHandle("app:get-application-info")
    getApplicationInfo(): ApplicationInfo {
        return Object.freeze({
            name: app.getName(),
            version: app.getVersion()
        });
    }

    @IpcHelper.IpcHandle("app:open-external-page")
    async openExternalPage(_event: IpcMainInvokeEvent, page: unknown) {
        let url: string;
        let pageName: string;

        switch (page)
        {
            case "support" satisfies ExternalApplicationPage:
                url = "https://ko-fi.com/jelosus1";
                pageName = "Ko-Fi";
                break;
            case "repository" satisfies ExternalApplicationPage:
                url = "https://github.com/Jelosus2/LORPlusModManager";
                pageName = "GitHub";
                break;
            default:
                throw new Error("Invalid external page request.");
        }

        try
        {
            await shell.openExternal(url);
        }
        catch (error)
        {
            throw ErrorUtils.withContext(`${pageName} could not be opened.`, error, "Windows could not open the page in your browser.");
        }
    }

    @IpcHelper.IpcHandle("app:get-application-logs")
    getApplicationLogs(): Promise<readonly ApplicationLogEntry[]> {
        return ApplicationLogger.getRecentEntries();
    }

    @IpcHelper.IpcHandle("app:write-application-log")
    writeApplicationLog(_event: IpcMainInvokeEvent, value: unknown) {
        if (!ApplicationLogger.isWriteRequest(value))
            throw new Error("Invalid application log request.");

        ApplicationLogger.write(value.severity, `Renderer · ${value.source}`, value.message, value.details);
    }

    private openModsFolder(errorMessage: string) {
        return this.openDirectory(Paths.getModsPath(), errorMessage, [Paths.getOperationsRoot(), Paths.getSyncOperationsRoot()]);
    }

    private async openDirectory(directoryPath: string, errorMessage: string, additionalDirectories: readonly string[] = []) {
        try
        {
            await Promise.all([directoryPath, ...additionalDirectories].map((entry) => fse.ensureDir(entry)));

            const shellError = await shell.openPath(directoryPath);
            if (shellError)
                throw new Error(shellError);
        }
        catch (error)
        {
            throw ErrorUtils.withContext(errorMessage, error, "Windows could not open the folder.");
        }
    }
}
