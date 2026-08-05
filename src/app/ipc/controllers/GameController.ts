import type { GameLaunchRequest } from "../../../shared/game.js";
import type { IpcMainInvokeEvent } from "electron";

import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { GameLauncherService } from "#game/GameLauncherService.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class GameController {
    private readonly launcherService = new GameLauncherService();

    @IpcHelper.IpcHandle("game:launch")
    async launchGame(_event: IpcMainInvokeEvent, request: GameLaunchRequest) {
        const operation = ApplicationLogger.startOperation(
            ApplicationLogSource.gameLauncher,
            request?.vanilla
                ? "Vanilla game launch"
                : "Modded game launch"
        );

        try
        {
            await this.launcherService.launch(request);

            operation.complete({
                mode: request.vanilla ? "vanilla" : "modded"
            });
        }
        catch (error)
        {
            const contextualError = ErrorUtils.withContext("The game could not be launched.", error, "An unexpected launcher error occurred.");

            operation.fail(contextualError);
            throw contextualError;
        }
    }
}
