import type { GameLocationResult, SetupState, GameLocationChangeProgress, GameLocationChangeResult, GameLocationSelectionResult } from "../../../shared/setup.js";
import type { IpcMainInvokeEvent } from "electron";

import { LOPluginInstallationService } from "#plugin/LOPluginInstallationService.js";
import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { GameInstallationService } from "#game/GameInstallationService.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { ModSynchronizer } from "#mod/ModSynchronizer.js";
import { BrowserWindow, dialog, shell } from "electron";
import { TypeCheck } from "#utils/TypeCheck.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export class SetupController {
    private readonly settingsRepository = new SettingsRepository();
    private readonly modRepository = new ModRepository();
    private readonly gameInstallation = new GameInstallationService();
    private readonly pluginInstallation = new LOPluginInstallationService();
    private readonly modSynchronizer = new ModSynchronizer();
    private isChangingGameLocation = false;

    @IpcHelper.IpcHandle("setup:game-location")
    async setupGameLocation(event: IpcMainInvokeEvent, value: unknown): Promise<GameLocationResult> {
        const selection = await this.selectGameLocation(event, value);

        if (selection.canceled)
            return this.locationFailure("The game location selection was canceled.");
        if (!selection.success)
            return this.locationFailure(selection.message);

        this.settingsRepository.setGameLocation(selection.path);

        return {
            success: true,
            path: selection.path,
            message: ""
        };
    }

    @IpcHelper.IpcHandle("setup:select-game-location")
    async selectGameLocation(event: IpcMainInvokeEvent, value: unknown): Promise<GameLocationSelectionResult> {
        if (!TypeCheck.isBoolean(value))
            return this.selectionFailure("Invalid game location selection request.");

        try
        {
            let installationPath: string;

            if (value)
            {
                const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
                const result = await dialog.showOpenDialog(window, {
                    title: "Select the Last Origin R+ game directory",
                    properties: ["openDirectory"]
                });

                if (result.canceled)
                    return this.selectionFailure("", true);

                installationPath = await this.gameInstallation.validate(result.filePaths[0]);
            }
            else
            {
                installationPath = await this.gameInstallation.detect();
            }

            return {
                success: true,
                canceled: false,
                path: installationPath,
                message: ""
            };
        }
        catch (error)
        {
            return this.selectionFailure(ErrorUtils.getUserErrorMessage(error, "The selected game location could not be validated."));
        }
    }

    @IpcHelper.IpcHandle("setup:change-game-location")
    async changeGameLocation(event: IpcMainInvokeEvent, value: unknown): Promise<GameLocationChangeResult> {
        if (this.isChangingGameLocation)
        {
            return {
                success: false,
                message: "The game location is already being changed."
            };
        }

        this.isChangingGameLocation = true;

        const operation = ApplicationLogger.startOperation(ApplicationLogSource.setup, "Game location change");

        const sendProgress = (progress: GameLocationChangeProgress) => {
            if (!event.sender.isDestroyed())
                event.sender.send("setup:game-location-change-progress", progress);
        };

        try
        {
            const gameLocation = await this.gameInstallation.validate(value);

            sendProgress({
                progress: 0,
                status: "Preparing the new game location",
                detail: gameLocation
            });

            const version = await this.pluginInstallation.reinstallAt(
                gameLocation,
                async (reportProgress) => {
                    await this.gameInstallation.validate(gameLocation);

                    const enabledMods = this.modRepository.getAll().filter((mod) => mod.enabled);
                    if (enabledMods.length === 0)
                    {
                        reportProgress({
                            progress: 100,
                            status: "No synchronized mods to remove",
                            detail: "The current mod state is already clean."
                        });

                        return;
                    }

                    const result = await this.modSynchronizer.synchronize({ method: "unsync", enabledModIds: [] }, (progress) => {
                        reportProgress({
                            progress: progress.progress,
                            status: progress.status,
                            detail: progress.detail
                        });
                    });

                    if (!result.success)
                    {
                        const failures = result.entries.filter((entry) => entry.status === "failed");
                        const visibleFailures = failures
                            .slice(0, 3)
                            .map((entry) => `${entry.directoryName}: ${entry.message}`)
                            .join(" ");

                        const remaining = failures.length - Math.min(failures.length, 3);
                        const remainingMessage = remaining > 0
                            ? ` ${remaining} additional mods could not be unsynchronized.`
                            : "";

                        throw new UserFacingError(
                            `The game location was not changed because ` +
                            `${failures.length} synchronized ` +
                            `${failures.length === 1 ? "mod" : "mods"} ` +
                            `could not be removed. ` +
                            `${visibleFailures}${remainingMessage}`
                        );
                    }
                },
                (progress) => {
                    sendProgress({
                        progress: progress.progress,
                        status: progress.status,
                        detail: progress.detail ?? gameLocation
                    });
                }
            );

            this.settingsRepository.setGameSetup(gameLocation, version);

            sendProgress({
                progress: 100,
                status: "Game location changed",
                detail: gameLocation
            });

            operation.complete({
                gameLocation,
                pluginVersion: version
            });

            return {
                success: true,
                message: "",
                gameLocation,
                pluginVersion: version
            };
        }
        catch (error)
        {
            operation.fail(error);

            return {
                success: false,
                message: ErrorUtils.getUserErrorMessage(error, "The game location could not be changed.")
            };
        }
        finally
        {
            this.isChangingGameLocation = false;
        }
    }

    @IpcHelper.IpcHandle("setup:get-state")
    async getSetupState(): Promise<SetupState> {
        const configuredLocation = this.settingsRepository.getGameLocation();
        if (!configuredLocation)
            return this.incompleteSetup();

        let gameLocation: string;

        try
        {
            gameLocation = await this.gameInstallation.validate(configuredLocation);
        }
        catch
        {
            return this.incompleteSetup();
        }

        const pluginVersion = this.settingsRepository.getLOPluginVersion();
        const pluginPath = path.join(Paths.getGamePluginRoot(gameLocation), "LOPlugin+.dll");
        const pluginIsInstalled = Boolean(pluginVersion && await fse.exists(pluginPath));

        return {
            isComplete: pluginIsInstalled,
            gameLocation,
            pluginVersion: pluginIsInstalled
                ? pluginVersion
                : null
        };
    }

    @IpcHelper.IpcHandle("setup:open-game-location")
    async openGameLocation() {
        const configuredLocation = this.settingsRepository.getGameLocation();
        if (!configuredLocation)
            throw new UserFacingError("The game location has not been configured.");

        const gameLocation = await this.gameInstallation.validate(configuredLocation);
        const shellError = await shell.openPath(gameLocation);

        if (shellError)
            throw new UserFacingError(`Windows could not open the game folder. ${shellError.trim()}`);
    }

    private locationFailure(message: string): GameLocationResult {
        return {
            success: false,
            message,
            path: ""
        };
    }

    private selectionFailure(message: string, canceled = false): GameLocationSelectionResult {
        return {
            success: false,
            canceled,
            path: "",
            message
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
