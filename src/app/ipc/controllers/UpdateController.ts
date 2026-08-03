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
    checkUpdates(_event: IpcMainInvokeEvent, value: unknown): Promise<UpdateCheckResult> {
        if (value !== "automatic" && value !== "manual")
            throw new UserFacingError("The update check request is invalid.");

        return updateCheckCoordinator.check(value);
    }

    @IpcHelper.IpcHandle("updates:download-application")
    downloadApplicationUpdate(event: IpcMainInvokeEvent): Promise<ApplicationUpdateDownloadResult> {
        return applicationUpdateService.download((progress) => {
            if (!event.sender.isDestroyed())
                event.sender.send("updates:application-download-progress", progress);
        });
    }

    @IpcHelper.IpcHandle("updates:install-application")
    installApplicationUpdate(): void {
        applicationUpdateService.install();
    }

    @IpcHelper.IpcHandle("updates:install-catalog")
    installCatalogUpdate(): Promise<CharacterCatalog> {
        return catalogUpdateService.update();
    }

    @IpcHelper.IpcHandle("updates:repair-catalog-icons")
    repairCatalogIcons(event: IpcMainInvokeEvent): Promise<CatalogIconRepairResult> {
        return catalogUpdateService.repairCatalogIcons((progress) => {
            if (!event.sender.isDestroyed())
                event.sender.send("updates:catalog-icon-repair-progress", progress);
        });
    }

    private async getCatalogVersion(): Promise<string | null> {
        try
        {
            return (await characterCatalog.getCatalog()).version;
        }
        catch (error)
        {
            console.error("Could not determine the installed character catalog version:", error);
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
