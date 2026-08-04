import type { ModLibraryStorageSummary } from "../../../shared/mod.js";

import { modLibraryStorageService } from "#mod/ModLibraryStorageService.js";
import { AdminPrivilegeService } from "#utils/AdminPrivilegeService.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { Paths } from "#utils/Paths.js";
import { shell } from "electron";
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

    @IpcHelper.IpcHandle("app:open-mod-library-folder")
    openModLibraryFolder() {
        return this.openModsFolder("The mod library folder could not be opened.");
    }

    private async openModsFolder(errorMessage: string) {
        const modsRoot = Paths.getModsPath();

        try
        {
            await Promise.all([
                fse.ensureDir(modsRoot),
                fse.ensureDir(Paths.getOperationsRoot()),
                fse.ensureDir(Paths.getSyncOperationsRoot())
            ]);

            const shellError = await shell.openPath(modsRoot);
            if (shellError)
                throw new Error(shellError);
        }
        catch (error)
        {
            throw ErrorUtils.withContext(errorMessage, error, "Windows could not open the folder.");
        }
    }
}
