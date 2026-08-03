import type { CheckedUpdateVersions, UpdateChecker } from "./UpdateChecker.js";
import type { UpdateComponent } from "../../shared/updates.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { LOPluginDownloader } from "#plugin/LOPluginDownloader.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { VersionUtils } from "#utils/VersionUtils.js";

export class PluginUpdateChecker implements UpdateChecker {
    private readonly settingsRepository = new SettingsRepository();
    private readonly downloader = new LOPluginDownloader();
    readonly component: UpdateComponent = "plugin";

    async check(): Promise<CheckedUpdateVersions> {
        const storedVersion = this.settingsRepository.getLOPluginVersion();
        if (!storedVersion)
            throw new UserFacingError("The installed LOPlugin+ version could not be determined.");

        const installedVersion = VersionUtils.validate(storedVersion, "installed LOPlugin+ version");
        const latestVersion = VersionUtils.validate(await this.downloader.getLatestVersion(), "latest LOPlugin+ version");

        return {
            installedVersion,
            latestVersion
        };
    }
}
