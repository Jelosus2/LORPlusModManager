import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { GameInstallationService } from "./GameInstallationService.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type ResolvedGameAssetBundle = Readonly<{
    bundleName: string;
    versionHash: string;
    filePath: string;
    lastUsedAt: number;
    unityDefaultResourcesPath: string | null;
}>;

export class GameAssetBundleResolver {
    private readonly settingsRepository = new SettingsRepository();
    private readonly installationService = new GameInstallationService();
    private readonly VERSION_HASH_PATTERN = /^[0-9a-f]{32}$/i;

    async resolveConfigured(bundleName: string): Promise<ResolvedGameAssetBundle> {
        const candidates = await this.findConfiguredCandidates(bundleName);
        if (candidates.length === 0)
            throw new UserFacingError(`The original game bundle "${bundleName}" is not available. Start or update the game once so it can download the required files.`);

        return candidates[0];
    }

    async findConfiguredCandidates(bundleName: string): Promise<readonly ResolvedGameAssetBundle[]> {
        if (!Paths.isSafeGameAssetBundleName(bundleName))
            throw new UserFacingError("The requested game asset bundle name is invalid.");

        const configuredLocation = this.settingsRepository.getGameLocation();
        if (!configuredLocation)
            throw new UserFacingError("The game location has not been configured.");

        const gameLocation = await this.installationService.validate(configuredLocation);
        return await this.findCandidates(gameLocation, bundleName);
    }

    async findCandidates(gameLocation: string, bundleName: string): Promise<readonly ResolvedGameAssetBundle[]> {
        if (!Paths.isSafeGameAssetBundleName(bundleName))
            throw new UserFacingError("The requested game asset bundle name is invalid.");

        const unityDefaultResourcesPath = await this.installationService.findUnityDefaultResourcesPath(gameLocation);
        const bundleRoot = Paths.getGameAssetBundleCachePath(gameLocation, bundleName);
        let entries: fse.Dirent[];

        try
        {
            entries = await fse.readdir(bundleRoot, { withFileTypes: true });
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return Object.freeze([]);

            throw ErrorUtils.withContext(`The game bundle cache for "${bundleName}" could not be read.`, error);
        }

        const candidates: ResolvedGameAssetBundle[] = [];

        for (const entry of entries)
        {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !this.VERSION_HASH_PATTERN.test(entry.name))
                continue;

            const versionRoot = path.join(bundleRoot, entry.name);
            const dataPath = path.join(versionRoot, "__data");
            let dataStats: fse.Stats;

            try
            {
                dataStats = await fse.lstat(dataPath);
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                    continue;

                throw ErrorUtils.withContext(`The cached game bundle "${bundleName}" could not be inspected.`, error);
            }

            if (!dataStats.isFile() || dataStats.isSymbolicLink() || dataStats.size === 0)
                continue;

            const infoModifiedAt = await this.getInfoModifiedAt(path.join(versionRoot, "__info"));

            candidates.push(Object.freeze({
                bundleName,
                versionHash: entry.name,
                filePath: dataPath,
                lastUsedAt: Math.max(dataStats.mtimeMs, infoModifiedAt),
                unityDefaultResourcesPath
            }));
        }

        candidates.sort((left, right) => {
            return right.lastUsedAt - left.lastUsedAt || right.versionHash.localeCompare(left.versionHash, "en-US");
        });

        return Object.freeze(candidates);
    }

    private async getInfoModifiedAt(infoPath: string): Promise<number> {
        try
        {
            const stats = await fse.lstat(infoPath);
            if (stats.isSymbolicLink() || !stats.isFile())
                return 0;

            return stats.mtimeMs;
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return 0;

            throw error;
        }
    }
}

export const gameAssetBundleResolver = new GameAssetBundleResolver();
