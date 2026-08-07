import type { CharacterCatalog, CatalogIconRepairProgress, CatalogIconRepairResult } from "../../shared/characters.js";

import { CatalogAssetCacheService } from "./CatalogAssetCacheService.js";
import { Paths } from "#utils/Paths.js";

export class CatalogIconService {
    static readonly MAX_CATALOG_ICON_SIZE = 1 * 1024 ** 2;
    private static readonly PNG_SIGNATURE = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
    ]);
    private readonly cache = new CatalogAssetCacheService({
        singularName: "character icon",
        pluralName: "character icons",
        accept: "image/png",
        maximumSize: CatalogIconService.MAX_CATALOG_ICON_SIZE,
        sourceDirectory: "../ui/assets/character_icons/",
        configuredBaseUrl: () => process.env.LORPLUS_CATALOG_ICON_BASE_URL,
        getCacheDirectory: () => Paths.getCachedCharacterIconsPath(),
        getCachePath: (fileName) => Paths.getCachedCharacterIconPath(fileName),
        isSafeFileName: Paths.isSafeCatalogIconName,
        isValidContents: CatalogIconService.hasPngSignature
    });

    installRequiredIcons(installedCatalog: CharacterCatalog, candidateCatalog: CharacterCatalog, catalogSourceUrl: URL) {
        return this.cache.installRequiredFiles(this.getCatalogIconFiles(installedCatalog), this.getCatalogIconFiles(candidateCatalog), catalogSourceUrl);
    }

    repairCatalogIcons(
        activeCatalog: CharacterCatalog,
        bundledCatalog: CharacterCatalog,
        catalogSourceUrl: URL,
        onProgress?: (progress: CatalogIconRepairProgress) => void
    ): Promise<CatalogIconRepairResult> {
        return this.cache.repairFiles(
            this.getCatalogIconFiles(activeCatalog),
            this.getCatalogIconFiles(bundledCatalog),
            catalogSourceUrl,
            (progress) => {
                onProgress?.({
                    processed: progress.processed,
                    total: progress.total,
                    downloaded: progress.downloaded,
                    currentIcon: progress.currentFile
                });
            }
        );
    }

    private getCatalogIconFiles(catalog: CharacterCatalog): string[] {
        return catalog.characters.map((entry) => entry.iconFile);
    }

    private static hasPngSignature(contents: Buffer): boolean {
        return (
            contents.length >= CatalogIconService.PNG_SIGNATURE.length &&
            contents.subarray(0, CatalogIconService.PNG_SIGNATURE.length).equals(CatalogIconService.PNG_SIGNATURE)
        );
    }
}

export const catalogIconService = new CatalogIconService();
