import type { AutomaticUpdatePreferences, ComponentUpdateResult, UpdateCheckMode, UpdateCheckResult, UpdateComponent } from "../../shared/updates.js";
import type { UpdateChecker } from "./UpdateChecker.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { applicationUpdateService } from "./ApplicationUpdateService.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { CatalogUpdateChecker } from "./CatalogUpdateChecker.js";
import { PluginUpdateChecker } from "./PluginUpdateChecker.js";
import { VersionUtils } from "#utils/VersionUtils.js";

export class UpdateCheckCoordinator {
    private readonly settingsRepository = new SettingsRepository();
    private readonly checkers: Record<UpdateComponent, UpdateChecker> = {
        application: applicationUpdateService,
        plugin: new PluginUpdateChecker(),
        catalog: new CatalogUpdateChecker()
    };

    async check(mode: UpdateCheckMode): Promise<UpdateCheckResult> {
        if (mode !== "automatic" && mode !== "manual")
            throw new UserFacingError("The update check mode is invalid.");

        const preferences = this.settingsRepository.getAutomaticUpdatePreferences();
        const components: readonly UpdateComponent[] = ["application", "plugin", "catalog"];
        const results = await Promise.all(components.map((component) => this.checkComponent(component, mode, preferences)));

        return {
            mode,
            checkedAt: new Date().toISOString(),
            components: results
        };
    }

    private async checkComponent(component: UpdateComponent, mode: UpdateCheckMode, preferences: AutomaticUpdatePreferences): Promise<ComponentUpdateResult> {
        const shouldCheck = mode === "manual" || preferences[component];
        if (!shouldCheck)
        {
            return {
                component,
                status: "not-checked",
                installedVersion: null,
                latestVersion: null,
                message: `Automatic ${this.getComponentName(component)} update checks are disabled.`,
                release: null
            };
        }

        try
        {
            const versions = await this.checkers[component].check();
            const updateAvailable = VersionUtils.isNewer(versions.latestVersion, versions.installedVersion);

            return {
                component,
                status: updateAvailable
                    ? "available"
                    : "up-to-date",
                installedVersion: versions.installedVersion,
                latestVersion: versions.latestVersion,
                message: updateAvailable
                    ? `${this.getComponentName(component)} ${versions.latestVersion} is available.`
                    : `${this.getComponentName(component)} is up to date.`,
                release: versions.release ?? null
            };
        }
        catch (error)
        {
            return {
                component,
                status: "error",
                installedVersion: null,
                latestVersion: null,
                message: ErrorUtils.combineWithCause(`Could not check for ${this.getComponentName(component)} updates.`, error),
                release: null
            };
        }
    }

    private getComponentName(component: UpdateComponent): string {
        switch (component)
        {
            case "application":
                return "Application";
            case "plugin":
                return "LOPlugin+";
            case "catalog":
                return "Character catalog";
        }
    }
}

export const updateCheckCoordinator = new UpdateCheckCoordinator();
