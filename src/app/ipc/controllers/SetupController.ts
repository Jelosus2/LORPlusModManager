import type { GameLocationResult } from "../../../shared/setup.js";
import type { IpcMainInvokeEvent } from "electron";

import { GameRegistry } from "#game/GameRegistry.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { BrowserWindow, dialog } from "electron";
import fse from "fs-extra";

export class SetupController {
    @IpcHelper.IpcHandle("setup:game-location")
    async setupGameLocation(event: IpcMainInvokeEvent, manualSetup: boolean): Promise<GameLocationResult> {
        const executableFileName = await GameRegistry.getExecutableFileName() ?? "LAST ORIGIN R+.exe";

        if (manualSetup)
        {
            const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];

            const result = await dialog.showOpenDialog(window, {
                title: "Select the Last Origin R+ game directory",
                properties: ["openDirectory"]
            });

            if (result.canceled)
                return { success: false, message: "The game location selection was canceled.", path: "" };

            const installationPath = result.filePaths[0];

            const isValidInstallationPath = (await fse.readdir(installationPath)).includes(executableFileName);
            if (!isValidInstallationPath)
                return { success: false, message: "The selected location doesn't contain the game executable.", path: "" };

            return { success: true, message: "", path: installationPath };
        }

        const installationPath = await GameRegistry.getInstallPath();
        if (!installationPath || !await fse.exists(installationPath))
            return { success: false, message: "Could not automatically discover the game location.", path: "" };

        const isValidInstallationPath = (await fse.readdir(installationPath)).includes(executableFileName);
        if (!isValidInstallationPath)
            return { success: false, message: "Game path detected but the game executable is missing", path: "" };

        return { success: true, message: "", path: installationPath };
    }
}
