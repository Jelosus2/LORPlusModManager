import type {
    AutomaticUpdatePreferenceRequest,
    AutomaticUpdatePreferences,
    UpdateCheckResult,
    UpdateComponent,
    UpdateSettingsState,
    ApplicationUpdateDownloadResult
} from "../../../shared/updates.js";
import type { CharacterCatalog, CatalogIconRepairResult } from "../../../shared/characters.js";
import type { IpcMainInvokeEvent } from "electron";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { applicationUpdateService } from "#update/ApplicationUpdateService.js";
import { updateCheckCoordinator } from "#update/UpdateCheckCoordinator.js";
import { catalogUpdateService } from "#update/CatalogUpdateService.js";
import { ApplicationLogSource } from "../../../shared/application.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { app } from "electron";

export class UpdateController {
    private readonly settingsRepository = new SettingsRepository();

    @IpcHelper.IpcHandle("updates:get-settings")
    async getSettings(): Promise<UpdateSettingsState> {
        return {
            preferences: this.settingsRepository.getAutomaticUpdatePreferences(),
            installedVersions: {
                application: app.getVersion(),
                plugin: this.settingsRepository.getLOPluginVersion(),
                catalog: await this.getCatalogVersion()
            },
            lastChecked: this.settingsRepository.getLastUpdateCheck()
        };
    }

    @IpcHelper.IpcHandle("updates:set-automatic-preference")
    setAutomaticPreference(_event: IpcMainInvokeEvent, value: unknown): AutomaticUpdatePreferences {
        const request = this.parsePreferenceRequest(value);
        this.settingsRepository.setAutomaticUpdatePreference(request.component, request.enabled);

        return this.settingsRepository.getAutomaticUpdatePreferences();
    }

    @IpcHelper.IpcHandle("updates:check")
    async checkUpdates(_event: IpcMainInvokeEvent, value: unknown): Promise<UpdateCheckResult> {
        if (value !== "automatic" && value !== "manual")
            throw new UserFacingError("The update check request is invalid.");

        const operation = ApplicationLogger.startOperation(ApplicationLogSource.updates, "Update check", { mode: value });

        try
        {
            const result = await updateCheckCoordinator.check(value);

            const summary = {
                mode: result.mode,
                checked: result.components.filter((component) => component.status !== "not-checked").length,
                available: result.components.filter((component) => component.status === "available").length,
                upToDate: result.components.filter((component) => component.status === "up-to-date").length,
                errors: result.components.filter((component) => component.status === "error").length
            };

            if (summary.errors > 0)
                operation.completeWithWarnings(summary);
            else
                operation.complete(summary);

            return result;
        }
        catch (error)
        {
            operation.fail(error);
            throw error;
        }
    }

    @IpcHelper.IpcHandle("updates:download-application")
    async downloadApplicationUpdate(event: IpcMainInvokeEvent): Promise<ApplicationUpdateDownloadResult> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.updates, "Application update download");

        try
        {
            const result = await applicationUpdateService.download((progress) => {
                if (!event.sender.isDestroyed())
                    event.sender.send("updates:application-download-progress", progress);
            });

            operation.complete({ version: result.version });
            return result;
        }
        catch (error)
        {
            operation.fail(error);
            throw error;
        }
    }

    @IpcHelper.IpcHandle("updates:install-application")
    installApplicationUpdate(): void {
        ApplicationLogger.info(ApplicationLogSource.updates, "Application update installation requested.");
        applicationUpdateService.install();
    }

    @IpcHelper.IpcHandle("updates:install-catalog")
    async installCatalogUpdate(): Promise<CharacterCatalog> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.catalog, "Character catalog update");

        try
        {
            const catalog = await catalogUpdateService.update();

            operation.complete({
                version: catalog.version,
                characters: catalog.characters.length
            });

            return catalog;
        }
        catch (error)
        {
            operation.fail(error);
            throw error;
        }
    }

    @IpcHelper.IpcHandle("updates:repair-catalog-icons")
    async repairCatalogIcons(event: IpcMainInvokeEvent): Promise<CatalogIconRepairResult> {
        const operation = ApplicationLogger.startOperation(ApplicationLogSource.catalog, "Character icon repair");

        try
        {
            const result = await catalogUpdateService.repairCatalogIcons((progress) => {
                if (!event.sender.isDestroyed())
                    event.sender.send("updates:catalog-icon-repair-progress", progress);
            });

            operation.complete({
                required: result.required,
                bundled: result.bundled,
                cached: result.cached,
                downloaded: result.downloaded
            });

            return result;
        }
        catch (error)
        {
            operation.fail(error);
            throw error;
        }
    }

    private async getCatalogVersion(): Promise<string | null> {
        try
        {
            return (await characterCatalog.getCatalog()).version;
        }
        catch (error)
        {
            ApplicationLogger.error(ApplicationLogSource.catalog, "Could not determine the installed character catalog version.", error);
            return null;
        }
    }

    private parsePreferenceRequest(value: unknown): AutomaticUpdatePreferenceRequest {
        if (!TypeCheck.isRecord(value) ||!this.isUpdateComponent(value.component) || !TypeCheck.isBoolean(value.enabled))
            throw new UserFacingError("The automatic update preference is invalid.");

        return {
            component: value.component,
            enabled: value.enabled
        };
    }

    private isUpdateComponent(value: unknown): value is UpdateComponent {
        return (
            value === "application" ||
            value === "plugin" ||
            value === "catalog"
        );
    }
}
