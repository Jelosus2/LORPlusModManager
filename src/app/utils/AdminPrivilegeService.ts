import { ErrorUtils, UserFacingError } from "./ErrorUtils.js";
import { execFile } from "node:child_process";

export class AdminPrivilegeService {
    private static privilegeCheck: Promise<boolean> | null = null;

    static async hasAdminPrivileges(): Promise<boolean> {
        const command =
            "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); " +
            "$principal = New-Object Security.Principal.WindowsPrincipal($identity); " +
            "[Console]::Out.Write(" +
                "$principal.IsInRole(" +
                    "[Security.Principal.WindowsBuiltInRole]::Administrator" +
                ").ToString().ToLowerInvariant()" +
            ")";

        AdminPrivilegeService.privilegeCheck ??= new Promise((resolve, reject) => {
            execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, encoding: "utf-8" }, (error, stdout) => {
                if (error)
                {
                    reject(
                        ErrorUtils.withContext(
                            "Windows could not check administrator privileges.",
                            error,
                            "The privilege-check command failed."
                        )
                    );
                    return;
                }

                const result = stdout.trim().toLowerCase();
                if (result === "true" || result === "false")
                {
                    resolve(result === "true");
                    return;
                }

                reject(new UserFacingError("Windows returned an invalid administrator privilege result."));
            });
        });

        try
        {
            return await AdminPrivilegeService.privilegeCheck;
        }
        catch (error)
        {
            AdminPrivilegeService.privilegeCheck = null;
            throw error;
        }
    }
}
