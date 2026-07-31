import { AdminPrivilegeService } from "#utils/AdminPrivilegeService.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class AppController {
    @IpcHelper.IpcHandle("app:has-admin-privileges")
    hasAdminPrivileges(): Promise<boolean> {
        return AdminPrivilegeService.hasAdminPrivileges();
    }
}
