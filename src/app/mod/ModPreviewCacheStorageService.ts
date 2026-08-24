import type { ModPreviewCacheStorageSummary } from "../../shared/mod.js";

import { directoryStorageService } from "#maintenance/DirectoryStorageService.js";
import { Paths } from "#utils/Paths.js";
import fse from "fs-extra";

export class ModPreviewCacheStorageService {
    async getSummary(): Promise<ModPreviewCacheStorageSummary> {
        const cachePath = Paths.getUnityPreviewCachePath();
        const measurement = await directoryStorageService.measure(cachePath);

        return Object.freeze({
            path: cachePath,
            sizeBytes: measurement.sizeBytes,
            fileCount: measurement.fileCount
        });
    }

    async delete(): Promise<ModPreviewCacheStorageSummary> {
        const cachePath = Paths.getUnityPreviewCachePath();
        const userDataPath = Paths.getUserDataPath();

        if (!Paths.isSubpath(userDataPath, cachePath))
            throw new Error("The mod preview cache is outside the application data directory.");

        await fse.rm(cachePath, {
            recursive: true,
            force: true,
            maxRetries: 2,
            retryDelay: 100
        });

        return Object.freeze({
            path: cachePath,
            sizeBytes: 0,
            fileCount: 0
        });
    }
}

export const modPreviewCacheStorageService = new ModPreviewCacheStorageService();
