import { execFile } from "node:child_process";

export class AdminPrivilegeService {
    private static privilegeCheck: Promise<boolean> | null = null;

    static hasAdminPrivileges(): Promise<boolean> {
        if (!AdminPrivilegeService.privilegeCheck)
        {
            AdminPrivilegeService.privilegeCheck = new Promise((resolve) => {
                execFile("net", ["session"], { windowsHide: true }, (error) => resolve(!error));
            });
        }

        return AdminPrivilegeService.privilegeCheck;
    }
}
