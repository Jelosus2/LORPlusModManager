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
        const recoveryRoot = Paths.getModsPath();

        try
        {
            await Promise.all([
                fse.ensureDir(Paths.getOperationsRoot()),
                fse.ensureDir(Paths.getSyncOperationsRoot())
            ]);

            const shellError = await shell.openPath(recoveryRoot);
            if (shellError)
                throw new Error(shellError);
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The recovery folder could not be opened.", error, "Windows could not open the folder.");
        }
    }
}
