import type { DownloadedPluginRelease } from "./LOPluginDownloader.js";
import type { PluginProgress } from "../../shared/plugin.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { ZipArchive } from "#utils/ZipArchive.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type InstallProgressCallback = (
    progress: PluginProgress
) => void;

export class LOPluginInstaller {
    private readonly archives = new ZipArchive();
    private readonly settingsRepository = new SettingsRepository();
    private readonly validationFiles = [
        "BepInEx/core/BepInEx.dll",
        "BepInEx/plugins/LOPlugin+/LOPlugin+.dll",
        "doorstop_config.ini",
        "winhttp.dll"
    ];

    async install(release: DownloadedPluginRelease, reportProgress: InstallProgressCallback) {
        const gameLocation = this.settingsRepository.getGameLocation();

        if (!gameLocation)
            throw new Error("The game location has not been configured.");
        if (!await fse.exists(gameLocation))
            throw new Error("The configured game location no longer exists.");

        const releaseDirectory = path.resolve(release.directory);

        const archivePaths = release.files.map((fileName) => {
            const archivePath = path.resolve(releaseDirectory, fileName);
            const relativePath = path.relative(releaseDirectory, archivePath);

            if (relativePath.startsWith("..") || path.isAbsolute(relativePath))
                throw new Error(`Unsafe release filename: ${fileName}`);

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

            reportProgress({ status: "Installing LOPlugin+...", progress: 80 });
            await fse.copy(stagingDirectory, gameLocation);

            this.settingsRepository.setLOPluginVersion(release.version);
            reportProgress({ status: `LOPlugin+ ${release.version} installed`, progress: 100 });
        }
        finally
        {
            try
            {
                await fse.rm(stagingDirectory, { recursive: true, force: true });
            }
            catch (cleanupError)
            {
                console.error("Could not clean the staging directory:", cleanupError);
            }
        }
    }

    private async validateStagedInstallation(stagingDirectory: string) {
        for (const file of this.validationFiles)
        {
            const filePath = path.join(stagingDirectory, ...file.split("/"));

            if (!await fse.exists(filePath))
                throw new Error(`The LOPlugin+ release is missing ${file}.`)
        }
    }
}
