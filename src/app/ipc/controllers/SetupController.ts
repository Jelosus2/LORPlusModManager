import type { GameLocationResult, SetupState } from "../../../shared/setup.js";
import type { IpcMainInvokeEvent } from "electron";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { GameRegistry } from "#game/GameRegistry.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { BrowserWindow, dialog } from "electron";
import path from "node:path";
import fse from "fs-extra";

export class SetupController {
    private readonly settingsRepository = new SettingsRepository();

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
                return this.setupGameLocationFailure("The game location selection was canceled.");

            const installationPath = result.filePaths[0];

            const isValidInstallationPath = (await fse.readdir(installationPath)).includes(executableFileName);
            if (!isValidInstallationPath)
                return this.setupGameLocationFailure("The selected location doesn't contain the game executable.");

            return this.saveGameLocation(installationPath);
        }

        const installationPath = await GameRegistry.getInstallPath();
        if (!installationPath || !await fse.exists(installationPath))
            return this.setupGameLocationFailure("Could not automatically discover the game location.");

        const isValidInstallationPath = (await fse.readdir(installationPath)).includes(executableFileName);
        if (!isValidInstallationPath)
            return this.setupGameLocationFailure("Game path detected but the game executable is missing.");

        return this.saveGameLocation(installationPath);
    }

    @IpcHelper.IpcHandle("setup:get-state")
    async getSetupState(): Promise<SetupState> {
        const gameLocation = this.settingsRepository.getGameLocation();
        const pluginVersion = this.settingsRepository.getLOPluginVersion();

        if (!gameLocation)
            return this.incompleteSetup();

        const executableFileName = await GameRegistry.getExecutableFileName() ?? "LAST ORIGIN R+.exe";
        const gameLocationIsValid = await fse.exists(path.join(gameLocation, executableFileName));

        if (!gameLocationIsValid)
            return this.incompleteSetup();

        const pluginPath = path.join(gameLocation, "BepInEx", "plugins", "LOPlugin+", "LOPlugin+.dll");
        const pluginIsInstalled = Boolean(pluginVersion && await fse.exists(pluginPath));

        return {
            isComplete: pluginIsInstalled,
            gameLocation,
            pluginVersion: pluginIsInstalled ? pluginVersion : null
        };
    }

    private saveGameLocation(gameLocation: string): GameLocationResult {
        this.settingsRepository.setGameLocation(gameLocation);

        return {
            success: true,
            message: "",
            path: gameLocation
        };
    }

    private setupGameLocationFailure(message: string): GameLocationResult {
        return {
            success: false,
            message,
            path: ""
        };
    }

    private incompleteSetup(): SetupState {
        return {
            isComplete: false,
            gameLocation: null,
            pluginVersion: null
        };
    }
}
