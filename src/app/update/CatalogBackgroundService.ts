import type { CharacterCatalog, CatalogBackgroundRepairProgress, CatalogBackgroundRepairResult } from "../../shared/characters.js";

import { CatalogAssetCacheService } from "./CatalogAssetCacheService.js";
import { Paths } from "#utils/Paths.js";

export class CatalogBackgroundService {
    static readonly MAX_CATALOG_BACKGROUND_SIZE = 2 * 1024 ** 2;
    private readonly cache = new CatalogAssetCacheService({
        singularName: "skin background",
        pluralName: "skin backgrounds",
        accept: "image/webp",
        maximumSize: CatalogBackgroundService.MAX_CATALOG_BACKGROUND_SIZE,
        sourceDirectory: "../ui/assets/skin_backgrounds/",
        configuredBaseUrl: () => process.env.LORPLUS_CATALOG_BACKGROUND_BASE_URL,
        getCacheDirectory: () => Paths.getCachedSkinBackgroundsPath(),
        getCachePath: (fileName) => Paths.getCachedSkinBackgroundPath(fileName),
        isSafeFileName: Paths.isSafeCatalogBackgroundName,
        isValidContents: CatalogBackgroundService.hasWebpSignature
    });

    installRequiredBackgrounds(installedCatalog: CharacterCatalog, candidateCatalog: CharacterCatalog, catalogSourceUrl: URL) {
        return this.cache.installRequiredFiles(this.getBackgroundFiles(installedCatalog), this.getBackgroundFiles(candidateCatalog), catalogSourceUrl);
    }

    repairCatalogBackgrounds(
        activeCatalog: CharacterCatalog,
        bundledCatalog: CharacterCatalog,
        catalogSourceUrl: URL,
        onProgress?: (progress: CatalogBackgroundRepairProgress) => void
    ): Promise<CatalogBackgroundRepairResult> {
        return this.cache.repairFiles(
            this.getBackgroundFiles(activeCatalog),
            this.getBackgroundFiles(bundledCatalog),
            catalogSourceUrl,
            (progress) => {
                onProgress?.({
                    processed: progress.processed,
                    total: progress.total,
                    downloaded: progress.downloaded,
                    currentBackground: progress.currentFile
                });
            }
        );
    }

    private getBackgroundFiles(catalog: CharacterCatalog): string[] {
        const files: string[] = [];

        for (const character of catalog.characters)
        {
            for (const layer of character.backgroundPreview?.layers ?? [])
                files.push(layer.file);
        }

        return files;
    }

    private static hasWebpSignature(contents: Buffer): boolean {
        return (
            contents.length >= 12 &&
            contents.subarray(0, 4).toString("ascii") === "RIFF" &&
            contents.subarray(8, 12).toString("ascii") === "WEBP"
        );
    }
}

export const catalogBackgroundService = new CatalogBackgroundService();
