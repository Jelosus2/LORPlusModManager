import type { GameLaunchRequest, GameLaunchResult } from "../../../shared/game.js";
import type { IpcMainInvokeEvent } from "electron";

import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { GameLauncherService } from "#game/GameLauncherService.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class GameController {
    private readonly launcherService = new GameLauncherService();

    @IpcHelper.IpcHandle("game:launch")
    async launchGame(_event: IpcMainInvokeEvent, request: GameLaunchRequest): Promise<GameLaunchResult> {
        const mode = request?.vanilla ? "vanilla" : "modded";

        const operation = ApplicationLogger.startOperation(
            ApplicationLogSource.gameLauncher,
            mode === "vanilla"
                ? "Vanilla game launch"
                : "Modded game launch"
        );

        try
        {
            const result = await this.launcherService.launch(request);
            const details = {
                mode,
                result: result.status
            };

            if (result.status === "launcher-required")
            {
                operation.completeWithWarnings({
                    ...details,
                    requirement: result.requirement,
                    minimumVersion: result.minimumVersion
                });
            }
            else
            {
                operation.complete(details);
            }

            return result;
        }
        catch (error)
        {
            const contextualError = ErrorUtils.withContext("The game could not be launched.", error, "An unexpected launcher error occurred.");

            operation.fail(contextualError);
            throw contextualError;
        }
    }
}
