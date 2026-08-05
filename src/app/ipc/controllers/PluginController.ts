import type { PluginInstallResult, PluginProgress } from "../../../shared/plugin.js";
import type { IpcMainInvokeEvent } from "electron";

import { LOPluginInstallationService } from "#plugin/LOPluginInstallationService.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class PluginController {
    private readonly installationService = new LOPluginInstallationService();

    @IpcHelper.IpcHandle("plugin:install")
    async installPlugin(event: IpcMainInvokeEvent): Promise<PluginInstallResult> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.plugin, "LOPlugin+ installation");

        const sendProgress = (progress: PluginProgress) => {
            if (!event.sender.isDestroyed())
                event.sender.send("plugin:install-progress", progress);
        };

        try
        {
            const version = await this.installationService.installConfigured(sendProgress);

            operation.complete({ version });

            return {
                success: true,
                message: "",
                version
            };
        }
        catch (error)
        {
            operation.fail(error);

            return {
                success: false,
                message: ErrorUtils.getUserErrorMessage(error, "An unexpected LOPlugin+ installation error occurred.")
            };
        }
    }
}
