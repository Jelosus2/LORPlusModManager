import type { UpdateComponent, ApplicationUpdateDownloadProgress, ApplicationUpdateDownloadResult, UpdateReleaseInfo } from "../../shared/updates.js";
import type { CheckedUpdateVersions, UpdateChecker } from "./UpdateChecker.js";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

import { UserFacingError } from "#utils/ErrorUtils.js";
import { VersionUtils } from "#utils/VersionUtils.js";
import electronUpdater from "electron-updater";
import { app } from "electron";

const { autoUpdater } = electronUpdater;

type ProgressListener = (progress: ApplicationUpdateDownloadProgress) => void;

export class ApplicationUpdateService implements UpdateChecker {
    private checkingPromise: Promise<CheckedUpdateVersions> | null = null;
    private downloadingPromise: Promise<ApplicationUpdateDownloadResult> | null = null;
    private availableVersion: string | null = null;
    private downloadedVersion: string | null = null;
    private readonly progressListeners = new Set<ProgressListener>();
    readonly component: UpdateComponent = "application";

    constructor() {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.allowPrerelease = false;
        autoUpdater.disableWebInstaller = true;

        autoUpdater.on("download-progress", (progress) => {
            this.handleDownloadProgress(progress);
        });

        autoUpdater.on("update-downloaded", (info) => {
            if (!this.availableVersion || info.version !== this.availableVersion)
                return;

            this.downloadedVersion = info.version;
            this.emitReady(info.version);
        });
    }

    check(): Promise<CheckedUpdateVersions> {
        this.checkingPromise ??= this.performCheck().finally(() => {
            this.checkingPromise = null;
        });

        return this.checkingPromise;
    }

    download(onProgress: ProgressListener): Promise<ApplicationUpdateDownloadResult> {
        if (!this.availableVersion)
            throw new UserFacingError("No application update is currently available.");

        this.progressListeners.add(onProgress);

        if (this.downloadedVersion === this.availableVersion)
        {
            this.emitReady(this.availableVersion);
            this.progressListeners.delete(onProgress);

            return Promise.resolve({ version: this.availableVersion });
        }

        this.downloadingPromise ??= this.performDownload().finally(() => {
            this.downloadingPromise = null;
        });

        return this.downloadingPromise.finally(() => {
            this.progressListeners.delete(onProgress);
        });
    }

    install() {
        if (!this.downloadedVersion)
            throw new UserFacingError("Download the application update before installing it.");

        autoUpdater.quitAndInstall(false, true);
    }

    private async performCheck(): Promise<CheckedUpdateVersions> {
        if (!app.isPackaged)
            throw new UserFacingError("Application updates can only be checked from an installed build.");

        const installedVersion = VersionUtils.validate(app.getVersion(), "installed application version");
        const result = await autoUpdater.checkForUpdates();

        if (!result)
            throw new UserFacingError("The application updater is unavailable in this build.");

        const latestVersion = VersionUtils.validate(result.updateInfo.version, "latest application version");

        this.availableVersion = VersionUtils.isNewer(latestVersion, installedVersion)
            ? latestVersion
            : null;

        if (this.downloadedVersion !== latestVersion)
            this.downloadedVersion = null;

        return {
            installedVersion,
            latestVersion,
            release: this.createReleaseInfo(result.updateInfo)
        };
    }

    private async performDownload(): Promise<ApplicationUpdateDownloadResult> {
        const version = this.availableVersion;
        if (!version)
            throw new UserFacingError("No application update is currently available.");

        this.emitProgress({
            phase: "downloading",
            version,
            progress: 0,
            transferredBytes: 0,
            totalBytes: 0,
            bytesPerSecond: 0
        });

        await autoUpdater.downloadUpdate();

        this.downloadedVersion = version;
        this.emitReady(version);

        return { version };
    }

    private handleDownloadProgress(progress: ProgressInfo) {
        if (!this.availableVersion)
            return;

        this.emitProgress({
            phase: "downloading",
            version: this.availableVersion,
            progress: Math.max(0, Math.min(100, progress.percent)),
            transferredBytes: progress.transferred,
            totalBytes: progress.total,
            bytesPerSecond: progress.bytesPerSecond
        });
    }

    private emitReady(version: string) {
        this.emitProgress({
            phase: "ready",
            version,
            progress: 100,
            transferredBytes: 0,
            totalBytes: 0,
            bytesPerSecond: 0
        });
    }

    private emitProgress(progress: ApplicationUpdateDownloadProgress) {
        for (const listener of this.progressListeners)
            listener(progress);
    }

    private createReleaseInfo(info: UpdateInfo): UpdateReleaseInfo {
        return {
            name: info.releaseName?.trim() || null,
            notes: this.normalizeReleaseNotes(info.releaseNotes),
            date: info.releaseDate?.trim() || null
        };
    }

    private normalizeReleaseNotes(notes: UpdateInfo["releaseNotes"]): string | null {
        const value = Array.isArray(notes)
            ? notes.map((entry) => entry.note?.trim()).filter((entry): entry is string => Boolean(entry)).join("\n\n")
            : notes?.trim();

        if (!value)
            return null;

        return value.slice(0, 20_000);
    }
}

export const applicationUpdateService = new ApplicationUpdateService();
