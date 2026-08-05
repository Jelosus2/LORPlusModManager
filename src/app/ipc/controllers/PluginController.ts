import type { PluginInstallResult, PluginProgress, PluginConfiguration, PluginConfigurationSaveRequest } from "../../../shared/plugin.js";
import type { IpcMainInvokeEvent } from "electron";

import { LOPluginConfigurationService } from "#plugin/LOPluginConfigurationService.js";
import { LOPluginInstallationService } from "#plugin/LOPluginInstallationService.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class PluginController {
    private readonly installationService = new LOPluginInstallationService();
    private readonly configurationService = new LOPluginConfigurationService();

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

    @IpcHelper.IpcHandle("plugin:get-configuration")
    async getConfiguration(): Promise<PluginConfiguration> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.plugin, "LOPlugin+ configuration load");

        try
        {
            const configuration = await this.configurationService.loadConfigured();

            operation.complete({
                exists: configuration.exists,
                sections: configuration.sections.length,
                settings: configuration.sections.reduce((total, section) => total + section.entries.length, 0)
            });

            return configuration;
        }
        catch (error)
        {
            const contextualError = ErrorUtils.withContext(
                "The LOPlugin+ configuration could not be loaded.",
                error,
                "An unexpected configuration error occurred."
            );

            operation.fail(contextualError);
            throw contextualError;
        }
    }

    @IpcHelper.IpcHandle("plugin:save-configuration")
    async saveConfiguration(_event: IpcMainInvokeEvent, request: PluginConfigurationSaveRequest): Promise<PluginConfiguration> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.plugin, "LOPlugin+ configuration save");

        try
        {
            const configuration = await this.configurationService.saveConfigured(request);

            operation.complete({
                sections: configuration.sections.length,
                settings: configuration.sections.reduce((total, section) => total + section.entries.length, 0)
            });

            return configuration;
        }
        catch (error)
        {
            const contextualError = ErrorUtils.withContext(
                "The LOPlugin+ configuration could not be saved.",
                error,
                "An unexpected configuration error occurred."
            );

            operation.fail(contextualError);
            throw contextualError;
        }
    }
}
