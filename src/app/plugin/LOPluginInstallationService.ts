import type { PluginProgress } from "../../shared/plugin.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { LOPluginDownloader } from "./LOPluginDownloader.js";
import { LOPluginInstaller } from "./LOPluginInstaller.js";
import { UserFacingError } from "#utils/ErrorUtils.js";

export type PluginInstallationProgress = PluginProgress & {
    detail?: string;
};

export type PluginInstallationProgressCallback = (
    progress: PluginInstallationProgress
) => void;

type BeforeInstallation = (
    reportProgress: PluginInstallationProgressCallback
) => Promise<void>;

export class LOPluginInstallationService {
    private readonly settingsRepository = new SettingsRepository();
    private readonly downloader = new LOPluginDownloader();
    private readonly installer = new LOPluginInstaller();
    private static operationInProgress = false;

    async installConfigured(reportProgress: PluginInstallationProgressCallback): Promise<string> {
        const gameLocation = this.settingsRepository.getGameLocation();
        if (!gameLocation)
            throw new UserFacingError("The game location has not been configured.");

        const version = await this.runInstallation(gameLocation, false, undefined, reportProgress, {
            downloadEnd: 70,
            beforeStart: 70,
            beforeEnd: 70,
            installStart: 70
        });

        this.settingsRepository.setLOPluginVersion(version);
        return version;
    }

    async reinstallAt(gameLocation: string, beforeInstallation: BeforeInstallation, reportProgress: PluginInstallationProgressCallback): Promise<string> {
        return this.runInstallation(gameLocation, true, beforeInstallation, reportProgress, {
            downloadEnd: 55,
            beforeStart: 55,
            beforeEnd: 70,
            installStart: 70
        });
    }

    private async runInstallation(
        gameLocation: string,
        cleanInstall: boolean,
        beforeInstallation: BeforeInstallation | undefined,
        reportProgress: PluginInstallationProgressCallback,
        ranges: {
            downloadEnd: number;
            beforeStart: number;
            beforeEnd: number;
            installStart: number;
        }
    ): Promise<string> {
        return this.runExclusive(async () => {
            const release = await this.downloader.download((progress) => {
                reportProgress(this.mapProgress(progress, 0, ranges.downloadEnd));
            });

            if (beforeInstallation)
            {
                await beforeInstallation((progress) => {
                    reportProgress(this.mapProgress(progress, ranges.beforeStart, ranges.beforeEnd));
                });
            }

            await this.installer.installAt(release, gameLocation, cleanInstall, (progress) => {
                reportProgress(this.mapProgress(progress, ranges.installStart, 100));
            });

            return release.version;
        });
    }

    private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        if (LOPluginInstallationService.operationInProgress)
            throw new UserFacingError("Another LOPlugin+ installation is already in progress.");

        LOPluginInstallationService.operationInProgress = true;

        try
        {
            return await operation();
        }
        finally
        {
            LOPluginInstallationService.operationInProgress = false;
        }
    }

    private mapProgress(progress: PluginInstallationProgress, start: number, end: number): PluginInstallationProgress {
        const normalized = Math.min(100, Math.max(0, progress.progress));

        return {
            ...progress,
            progress: start + normalized / 100 * (end - start)
        }
    }
}
