import type { DownloadedPluginRelease } from "./LOPluginDownloader.js";
import type { PluginProgress } from "../../shared/plugin.js";

import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { ZipArchive } from "#utils/ZipArchive.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type InstallProgressCallback = (
    progress: PluginProgress
) => void;

export class LOPluginInstaller {
    private readonly archives = new ZipArchive();
    private readonly validationFiles = [
        "BepInEx/core/BepInEx.dll",
        "BepInEx/plugins/LOPlugin+/LOPlugin+.dll",
        "doorstop_config.ini",
        "winhttp.dll"
    ];

    async installAt(release: DownloadedPluginRelease, gameLocation: string, cleanInstall: boolean, reportProgress: InstallProgressCallback) {
        if (!await fse.exists(gameLocation))
            throw new UserFacingError("The selected game location no longer exists.");

        const releaseDirectory = path.resolve(release.directory);

        const archivePaths = release.files.map((fileName) => {
            const archivePath = path.resolve(releaseDirectory, fileName);
            const relativePath = path.relative(releaseDirectory, archivePath);

            if (relativePath.startsWith("..") || path.isAbsolute(relativePath))
                throw new UserFacingError(`"The LOPlugin+ release contains an unsafe filename."`);

            return archivePath;
        });

        const stagingDirectory = Paths.getPluginInstallationStagingPath(release.version);
        await fse.rm(stagingDirectory, { recursive: true, force: true });

        try
        {
            reportProgress({ status: "Extracting LOPlugin+...", progress: 0 });

            await this.archives.extractArchives(
                archivePaths,
                stagingDirectory,
                {
                    maxEntries: 50,
                    maxEntryUncompressedBytes: 3 * 1024 ** 2,
                    maxTotalUncompressedBytes: 5 * 1024 ** 2
                },
                ({ completedEntries, totalEntries }) => {
                    reportProgress({
                        status: "Extracting LOPlugin+...",
                        progress: totalEntries === 0
                            ? 70
                            : completedEntries / totalEntries * 70
                    });
                }
            );

            await this.validateStagedInstallation(stagingDirectory);

            if (cleanInstall)
            {
                reportProgress({ status: "Removing the existing LOPlugin+ installation...", progress: 75 });
                await this.removeExistingInstallation(gameLocation);
            }

            reportProgress({ status: "Installing LOPlugin+...", progress: 80 });
            await fse.copy(stagingDirectory, gameLocation);
            reportProgress({ status: `LOPlugin+ ${release.version} installed`, progress: 100 });
        }
        finally
        {
            try
            {
                await fse.rm(stagingDirectory, { recursive: true, force: true });
            }
            catch (error)
            {
                ApplicationLogger.warning(ApplicationLogSource.plugin, "Could not clean the staging directory.", error);
            }
        }
    }

    private async validateStagedInstallation(stagingDirectory: string) {
        for (const file of this.validationFiles)
        {
            const filePath = path.join(stagingDirectory, ...file.split("/"));

            if (!await fse.exists(filePath))
                throw new UserFacingError(`The LOPlugin+ release is missing ${file}.`);
        }
    }

    private async removeExistingInstallation(gameLocation: string) {
        const targets = [
            path.join(gameLocation, "BepInEx"),
            path.join(gameLocation, "doorstop_config.ini"),
            path.join(gameLocation, "winhttp.dll"),
            path.join(gameLocation, "changelog.txt"),
            path.join(gameLocation, ".doorstop_version")
        ];

        for (const target of targets)
        {
            if (!Paths.isSubpath(gameLocation, target))
                throw new Error("An unsafe BepInEx cleanup path was generated.");

            await fse.rm(target, { recursive: true, force: true });
        }
    }
}
