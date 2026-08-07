import type {
    CharacterCatalog,
    CatalogIconRepairProgress,
    CatalogIconRepairResult,
    CatalogBackgroundRepairProgress,
    CatalogBackgroundRepairResult
} from "../../shared/characters.js";
import type { CheckedUpdateVersions, UpdateChecker } from "./UpdateChecker.js";
import type { UpdateComponent } from "../../shared/updates.js";

import { CharacterCatalogService, characterCatalog } from "#utils/CharacterCatalogService.js";
import { catalogBackgroundService } from "./CatalogBackgroundService.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { GitHubRequestUtils } from "#utils/GitHubRequestUtils.js";
import { HttpDownloadUtils } from "#utils/HttpDownloadUtils.js";
import { catalogIconService } from "./CatalogIconService.js";
import { VersionUtils } from "#utils/VersionUtils.js";

type DownloadedCatalog = {
    catalog: CharacterCatalog;
    contents: string;
    sourceUrl: URL;
};

export class CatalogUpdateService implements UpdateChecker {
    private static readonly CHARACTER_CATALOG_URL = "https://raw.githubusercontent.com/Jelosus2/LORPlusModManager/refs/heads/main/src/data/characters.json";
    private updatePromise: Promise<CharacterCatalog> | null = null;
    readonly component: UpdateComponent = "catalog";

    async check(): Promise<CheckedUpdateVersions> {
        const installedCatalog = await characterCatalog.getCatalog();
        const downloaded = await this.downloadLatest();

        return {
            installedVersion: VersionUtils.validate(installedCatalog.version, "installed character catalog version"),
            latestVersion: VersionUtils.validate(downloaded.catalog.version, "downloaded character catalog version")
        };
    }

    async repairCatalogIcons(onProgress?: (progress: CatalogIconRepairProgress) => void): Promise<CatalogIconRepairResult> {
        const [activeCatalog, bundledCatalog] = await Promise.all([
            characterCatalog.getCatalog(),
            characterCatalog.getBundledCatalog()
        ]);

        return catalogIconService.repairCatalogIcons(activeCatalog, bundledCatalog, this.getCatalogUrl(), onProgress);
    }

    async repairCatalogBackgrounds(onProgress?: (progress: CatalogBackgroundRepairProgress) => void): Promise<CatalogBackgroundRepairResult> {
        const [activeCatalog, bundledCatalog] = await Promise.all([
            characterCatalog.getCatalog(),
            characterCatalog.getBundledCatalog()
        ]);

        return catalogBackgroundService.repairCatalogBackgrounds(activeCatalog, bundledCatalog, this.getCatalogUrl(), onProgress);
    }

    update(): Promise<CharacterCatalog> {
        if (this.updatePromise)
            return this.updatePromise;

        this.updatePromise = this.installLatest();

        return this.updatePromise.finally(() => {
            this.updatePromise = null;
        });
    }

    private async installLatest(): Promise<CharacterCatalog> {
        const installedCatalog = await characterCatalog.getCatalog();
        const downloaded = await this.downloadLatest();
        const comparison = VersionUtils.compare(downloaded.catalog.version, installedCatalog.version);

        if (comparison < 0)
            throw new UserFacingError(`The downloaded catalog ${downloaded.catalog.version} is older than the installed catalog ${installedCatalog.version}.`);
        if (comparison === 0)
            return installedCatalog;

        await Promise.all([
            catalogIconService.installRequiredIcons(installedCatalog, downloaded.catalog, downloaded.sourceUrl),
            catalogBackgroundService.installRequiredBackgrounds(installedCatalog, downloaded.catalog, downloaded.sourceUrl)
        ]);

        return characterCatalog.installCatalogContents(downloaded.contents);
    }

    private async downloadLatest(): Promise<DownloadedCatalog> {
        const sourceUrl = this.getCatalogUrl();

        const response = await fetch(sourceUrl, {
            headers: GitHubRequestUtils.createDownloadHeaders(sourceUrl, "application/json"),
            cache: "no-store",
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok)
            throw this.createHttpError(response.status);

        const contents = (
            await HttpDownloadUtils.readLimitedBody(
                response,
                CharacterCatalogService.MAX_CATALOG_SIZE,
                "The downloaded character catalog is unexpectedly large.",
                "The character catalog server returned an empty response."
            )
        ).toString("utf-8");

        try
        {
            const catalog = characterCatalog.parseCatalogContents(contents);
            VersionUtils.validate(catalog.version, "downloaded character catalog version");

            return {
                catalog,
                contents,
                sourceUrl
            };
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The downloaded character catalog could not be validated.", error);
        }
    }

    private getCatalogUrl(): URL {
        const value = process.env.LORPLUS_CATALOG_URL?.trim() || CatalogUpdateService.CHARACTER_CATALOG_URL;
        let url: URL;

        try
        {
            url = new URL(value);
        }
        catch
        {
            throw new UserFacingError("The character catalog update address is invalid.");
        }

        if (url.protocol !== "https:")
            throw new UserFacingError("The character catalog update address must use HTTPS.");

        return url;
    }

    private createHttpError(status: number): UserFacingError {
        switch (status)
        {
            case 401:
            case 403:
                return new UserFacingError("The character catalog request was not authorized. The temporary access link may have expired.");
            case 404:
                return new UserFacingError("The online character catalog could not be found.");
            default:
                return new UserFacingError(`The character catalog server returned HTTP ${status}.`);
        }
    }
}

export const catalogUpdateService = new CatalogUpdateService();
