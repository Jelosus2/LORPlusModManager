import type { ApplicationUpdateManifest, UpdateComponent } from "../../shared/updates.js";
import type { CheckedUpdateVersions, UpdateChecker } from "./UpdateChecker.js";

import { GitHubReleaseClient } from "#utils/GitHubReleaseClient.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { VersionUtils } from "#utils/VersionUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { app } from "electron";

export class ApplicationUpdateChecker implements UpdateChecker {
    private readonly REPOSITORY = "Jelosus2/LORPlusModManager";
    private readonly MANIFEST_NAME = "version-info.json";
    private readonly githubClient = new GitHubReleaseClient();
    readonly component: UpdateComponent = "application";

    async check(): Promise<CheckedUpdateVersions> {
        const installedVersion = VersionUtils.validate(app.getVersion(), "installed application version");
        const release = await this.githubClient.getLatestRelease(this.REPOSITORY);
        const manifestAsset = this.githubClient.findAsset(release, this.MANIFEST_NAME);
        const manifest = this.parseManifest(await this.githubClient.readAssetJson(manifestAsset));
        const tagVersion = release.tagName.replace(/^v/, "");

        if (tagVersion !== manifest.version)
            throw new UserFacingError(`Release ${release.tagName} contains update metadata for version ${manifest.version}.`);
        if (manifest.minimumVersion !== undefined && VersionUtils.isNewer(manifest.minimumVersion, manifest.version))
            throw new UserFacingError("The application update manifest has a minimum version newer than its release version.");

        return {
            installedVersion,
            latestVersion: manifest.version,
            required: manifest.mandatory || (manifest.minimumVersion !== undefined && VersionUtils.compare(installedVersion, manifest.minimumVersion) < 0)
        };
    }

    private parseManifest(value: unknown): ApplicationUpdateManifest {
        if (!TypeCheck.isRecord(value))
            throw new UserFacingError(`${this.MANIFEST_NAME} is not a JSON object.`);

        const version = VersionUtils.validate(value.version, "application release version");

        if (!TypeCheck.isBoolean(value.mandatory))
            throw new UserFacingError(`${this.MANIFEST_NAME} contains an invalid mandatory value.`);

        if (value.minimumVersion === undefined)
        {
            return Object.freeze({
                version,
                mandatory: value.mandatory
            });
        }

        const minimumVersion = VersionUtils.validate(value.minimumVersion, "minimum application version");

        return Object.freeze({
            version,
            mandatory: value.mandatory,
            minimumVersion
        });
    }
}
