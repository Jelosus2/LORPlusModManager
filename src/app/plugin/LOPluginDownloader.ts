import type { PluginProgress } from "../../shared/plugin.js";

import { TypeCheck } from "#utils/TypeCheck.js";
import { createHash } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import fsp from "node:fs/promises";
import path from "node:path";
import fse from "fs-extra";

type GitHubReleaseAsset = {
    name: string;
    browser_download_url: string;
    size: number;
};

type GitHubRelease = {
    tag_name: string;
    assets: GitHubReleaseAsset[];
};

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
    private readonly LATEST_RELEASE_URL = `https://api.github.com/repos/${this.REPOSITORY}/releases/latest`;
    private readonly MANIFEST_NAME = "version-info.json";

    async download(reportProgress: ProgressCallback): Promise<DownloadedPluginRelease> {
        reportProgress({
            status: "Checking the latest LOPlugin+ release...",
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0
        });

        const release = await this.getLatestRelease();
        const manifestAsset = this.findAsset(release, this.MANIFEST_NAME);
        const manifest = await this.getVersionInfo(manifestAsset);

        this.validateReleaseVersion(release, manifest);

        const assets = manifest.files.map((fileName) => {
            const asset = this.findAsset(release, fileName);

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
            await fse.rm(downloadDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    private async getLatestRelease(): Promise<GitHubRelease> {
        const response = await fetch(this.LATEST_RELEASE_URL, {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "LORPlusModManager"
            },
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok)
            throw new Error(`GitHub returned status ${response.status} while checking LOPlugin+ latest release.`);

        const value = await response.json();
        if (!this.isGithubRelease(value))
            throw new Error("GitHub returned invalid release information.");

        return value;
    }

    private isGithubRelease(value: unknown): value is GitHubRelease {
        if (!TypeCheck.isRecord(value))
            return false;

        const release = value as Partial<GitHubRelease>;

        return (
            TypeCheck.isValidString(release.tag_name) &&
            TypeCheck.isValidArray(release.assets) &&
            release.assets.every((asset) =>
                asset &&
                TypeCheck.isValidString(asset.name) &&
                TypeCheck.isValidString(asset.browser_download_url) &&
                TypeCheck.isValidInteger(asset.size)
            )
        );
    }

    private findAsset(release: GitHubRelease, fileName: string): GitHubReleaseAsset {
        const asset = release.assets.find((candidate) => candidate.name === fileName);
        if (!asset)
            throw new Error(`${fileName} is missing from release ${release.tag_name}.`);

        return asset;
    }

    private async getVersionInfo(manifestAsset: GitHubReleaseAsset): Promise<VersionInfo> {
        const response = await fetch(manifestAsset.browser_download_url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "LORPlusModManager"
            },
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok)
            throw new Error(`Could not download ${this.MANIFEST_NAME}: HTTP ${response.status}.`);

        return this.parseVersionInfo(await response.json());
    }

    private parseVersionInfo(value: unknown): VersionInfo {
        if (!TypeCheck.isRecord(value))
            throw new Error(`${this.MANIFEST_NAME} is not a JSON object.`);

        const manifest = value as Partial<VersionInfo>;

        if (!TypeCheck.isValidString(manifest.version) || !/^[0-9A-Za-z._-]+$/.test(manifest.version))
            throw new Error(`${this.MANIFEST_NAME} contains an invalid version.`);
        if (!TypeCheck.isRecord(manifest.checksums) || TypeCheck.isValidArray(manifest.checksums))
            throw new Error(`${this.MANIFEST_NAME} contains invalid checksums.`);

        if (
            !TypeCheck.isValidArray(manifest.files) ||
            manifest.files.length === 0 ||
            manifest.files.some((file) => !TypeCheck.isValidString(file))
        )
        {
            throw new Error(`${this.MANIFEST_NAME} contains an invalid files list.`);
        }

        const files = [...new Set(manifest.files)];

        for (const fileName of files)
        {
            if (path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith(".zip"))
                throw new Error(`Expected ${this.MANIFEST_NAME} to be a zip.`);

            const checksum = manifest.checksums[fileName];
            if (!TypeCheck.isValidString(checksum) || !/^[a-fA-F0-9]{64}$/.test(checksum))
                throw new Error(`${this.MANIFEST_NAME} has no valid checksum for ${fileName}.`);
        }

        return {
            version: manifest.version,
            files,
            checksums: manifest.checksums
        };
    }

    private validateReleaseVersion(release: GitHubRelease, manifest: VersionInfo) {
        const tagVersion = release.tag_name.replace(/^v/, "");

        if (tagVersion !== manifest.version)
            throw new Error(`Release ${release.tag_name} contains version ${manifest.version} metadata`);
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
        const response = await fetch(asset.browser_download_url, {
            headers: {
                Accept: "application/octet-stream",
                "User-Agent": "LORPlusModManager"
            },
            signal: AbortSignal.timeout(5 * 60_000)
        });

        if (!response.ok)
            throw new Error(`Could not download ${asset.name}: HTTP ${response.status}.`);
        if (!response.body)
            throw new Error(`${asset.name} returned an empty response.`);

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
                        throw new Error(`Failed to write ${asset.name}.`);

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
            throw new Error(`${asset.name} was incomplete: expected ${asset.size} bytes, received ${receivedBytes}.`);
        }

        const calculatedChecksum = hash.digest("hex");
        if (calculatedChecksum.toLowerCase() !== checksum.toLowerCase())
        {
            await fse.rm(partialDestination, { force: true });
            throw new Error(`Checksum verification failed for ${asset.name}.`);
        }

        await fse.rename(partialDestination, destination);
    }
}
