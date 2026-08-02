import type { GitHubRelease, GitHubReleaseAsset } from "#utils/GitHubReleaseClient.js";
import type { PluginProgress } from "../../shared/plugin.js";

import { GitHubReleaseClient } from "#utils/GitHubReleaseClient.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { VersionUtils } from "#utils/VersionUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { createHash } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import fsp from "node:fs/promises";
import path from "node:path";
import fse from "fs-extra";

type VersionInfo = {
    version: string;
    files: string[];
    checksums: Record<string, string>;
};

export type DownloadedPluginRelease = {
    version: string;
    directory: string;
    files: string[];
};

export type ProgressCallback = (progress: PluginProgress) => void;

export class LOPluginDownloader {
    private readonly REPOSITORY = "Jelosus2/LOPluginPlus-Releases";
    private readonly MANIFEST_NAME = "version-info.json";
    private readonly githubClient = new GitHubReleaseClient();

    async download(reportProgress: ProgressCallback): Promise<DownloadedPluginRelease> {
        reportProgress({
            status: "Checking the latest LOPlugin+ release...",
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0
        });

        const { release, manifest } = await this.getLatestVersionInformation();

        const assets = manifest.files.map((fileName) => {
            const asset = this.githubClient.findAsset(release, fileName);

            return {
                asset,
                checksum: manifest.checksums[fileName]
            };
        });

        const totalBytes = assets.reduce((total, entry) => total + entry.asset.size, 0);
        const downloadDirectory = path.join(Paths.getPluginDownloadCachePath(), manifest.version);

        await fse.rm(downloadDirectory, { recursive: true, force: true });
        await fse.ensureDir(downloadDirectory);

        let downloadedBytes = 0;
        let lastProgressEvent = 0;

        try
        {
            for (let i = 0; i < assets.length; i++)
            {
                const { asset, checksum } = assets[i];

                const status = `Downloading ${asset.name} (${i + 1}/${assets.length})`;

                reportProgress({
                    status,
                    progress: this.calculateProgress(downloadedBytes, totalBytes),
                    downloadedBytes,
                    totalBytes
                });

                await this.downloadAsset(
                    asset,
                    checksum,
                    downloadDirectory,
                    (chunkSize) => {
                        downloadedBytes += chunkSize;

                        const now = Date.now();
                        const isComplete = downloadedBytes >= totalBytes;

                        if (!isComplete && now - lastProgressEvent < 100)
                            return;

                        lastProgressEvent = now;

                        reportProgress({
                            status,
                            progress: this.calculateProgress(downloadedBytes, totalBytes),
                            downloadedBytes,
                            totalBytes
                        });
                    }
                );
            }

            reportProgress({
                status: "Download complete",
                progress: 100,
                downloadedBytes: totalBytes,
                totalBytes
            });

            return {
                version: manifest.version,
                directory: downloadDirectory,
                files: [...manifest.files]
            };
        }
        catch (error)
        {
            try
            {
                await fse.rm(downloadDirectory, { recursive: true, force: true });
            }
            catch (cleanupError)
            {
                console.error("Could not clean the failed plugin download:", cleanupError);
            }

            throw error;
        }
    }

    async getLatestVersion(): Promise<string> {
        const { manifest } = await this.getLatestVersionInformation();
        return manifest.version;
    }

    private async getLatestVersionInformation(): Promise<{ release: GitHubRelease; manifest: VersionInfo; }> {
        const release = await this.githubClient.getLatestRelease(this.REPOSITORY);
        const manifestAsset = this.githubClient.findAsset(release, this.MANIFEST_NAME);
        const manifest = this.parseVersionInfo(await this.githubClient.readAssetJson(manifestAsset));

        this.validateReleaseVersion(release, manifest);

        return {
            release,
            manifest
        };
    }

    private parseVersionInfo(value: unknown): VersionInfo {
        if (!TypeCheck.isRecord(value))
            throw new UserFacingError(`${this.MANIFEST_NAME} is not a JSON object.`);

        const manifest = value as Partial<VersionInfo>;
        const version = VersionUtils.validate(manifest.version, "LOPlugin+ version");

        if (!TypeCheck.isRecord(manifest.checksums) || TypeCheck.isValidArray(manifest.checksums))
            throw new UserFacingError(`${this.MANIFEST_NAME} contains invalid checksums.`);
        if (!TypeCheck.isValidArray(manifest.files, 10) || manifest.files.some((file) => !TypeCheck.isValidString(file)))
            throw new UserFacingError(`${this.MANIFEST_NAME} contains an invalid files list.`);

        const files = [...new Set(manifest.files)];

        for (const fileName of files)
        {
            if (path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith(".zip"))
                throw new UserFacingError(`${this.MANIFEST_NAME} contains a file that is not a supported ZIP archive.`);

            const checksum = manifest.checksums[fileName];
            if (!TypeCheck.isValidString(checksum) || !/^[a-fA-F0-9]{64}$/.test(checksum))
                throw new UserFacingError(`${this.MANIFEST_NAME} has no valid checksum for ${fileName}.`);
        }

        return {
            version,
            files,
            checksums: manifest.checksums
        };
    }

    private validateReleaseVersion(release: GitHubRelease, manifest: VersionInfo) {
        const tagVersion = release.tagName.replace(/^v/, "");

        if (tagVersion !== manifest.version)
            throw new UserFacingError(`Release ${release.tagName} contains metadata for version ${manifest.version}.`);
    }

    private calculateProgress(downloadedBytes: number, totalBytes: number): number {
        if (totalBytes <= 0)
            return 0;

        return Math.min(100, Math.max(0, downloadedBytes / totalBytes * 100));
    }

    private async downloadAsset(
        asset: GitHubReleaseAsset,
        checksum: string,
        directory: string,
        onChunk: (size: number) => void
    ) {
        const response = await fetch(asset.downloadUrl, {
            headers: {
                Accept: "application/octet-stream",
                "User-Agent": "LORPlusModManager"
            },
            signal: AbortSignal.timeout(5 * 60_000)
        });

        if (!response.ok)
            throw new UserFacingError(`Could not download ${asset.name}: HTTP ${response.status}.`);
        if (!response.body)
            throw new UserFacingError(`${asset.name} returned an empty response.`);

        const destination = path.join(directory, asset.name);
        const partialDestination = `${destination}.part`;

        await fse.rm(partialDestination, { force: true });

        const file = await fsp.open(partialDestination, "w");
        const reader = response.body.getReader();
        const hash = createHash("sha256");

        let receivedBytes = 0;

        try
        {
            while (true)
            {
                const { done, value } = await reader.read();

                if (done)
                    break;

                const chunk = Buffer.from(value);
                let offset = 0;

                while (offset < chunk.length)
                {
                    const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, null);
                    if (bytesWritten === 0)
                        throw new UserFacingError(`Failed to write ${asset.name}.`);

                    offset += bytesWritten;
                }


                hash.update(chunk);
                receivedBytes += chunk.length;
                onChunk(chunk.length);
            }
        }
        catch (error)
        {
            await reader.cancel(error).catch(() => undefined);
            throw error;
        }
        finally
        {
            reader.releaseLock();
            await file.close();
        }

        if (asset.size > 0 && receivedBytes !== asset.size)
        {
            await fse.rm(partialDestination, { force: true });
            throw new UserFacingError(`${asset.name} was incomplete: expected ${asset.size} bytes, received ${receivedBytes}.`);
        }

        const calculatedChecksum = hash.digest("hex");
        if (calculatedChecksum.toLowerCase() !== checksum.toLowerCase())
        {
            await fse.rm(partialDestination, { force: true });
            throw new UserFacingError(`Checksum verification failed for ${asset.name}.`);
        }

        await fse.rename(partialDestination, destination);
    }
}
