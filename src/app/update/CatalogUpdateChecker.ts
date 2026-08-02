import type { CheckedUpdateVersions, UpdateChecker } from "./UpdateChecker.js";
import type { UpdateComponent } from "../../shared/updates.js";

import { CharacterCatalogService, characterCatalog } from "#utils/CharacterCatalogService.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { VersionUtils } from "#utils/VersionUtils.js";

export class CatalogUpdateChecker implements UpdateChecker {
    private static readonly CHARACTER_CATALOG_URL = "https://raw.githubusercontent.com/Jelosus2/LORPlusModManager/refs/heads/main/src/data/characters.json";
    readonly component: UpdateComponent = "catalog";

    async check(): Promise<CheckedUpdateVersions> {
        const installedCatalog = await characterCatalog.getCatalog();
        const installedVersion = VersionUtils.validate(installedCatalog.version, "installed character catalog version");

        const response = await fetch(this.getCatalogUrl(), {
            headers: {
                Accept: "application/json",
                "User-Agent": "LORPlusModManager"
            },
            cache: "no-store",
            signal: AbortSignal.timeout(30_000)
        });

        if (!response.ok)
            throw this.createHttpError(response.status);

        const contentLength = response.headers.get("content-length");
        if (contentLength !== null)
        {
            const declaredSize = Number(contentLength);
            if (Number.isFinite(declaredSize) && declaredSize > CharacterCatalogService.MAX_CATALOG_SIZE)
                throw new UserFacingError("The downloaded character catalog is unexpectedly large.");
        }

        const contents = await response.text();
        let latestVersion: string;

        try
        {
            const downloadedCatalog = characterCatalog.parseCatalogContents(contents);
            latestVersion = VersionUtils.validate(downloadedCatalog.version, "downloaded character catalog version");
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The downloaded character catalog could not be validated.", error);
        }

        return {
            installedVersion,
            latestVersion,
            required: false
        };
    }

    private getCatalogUrl(): string {
        const value = process.env.LORPLUS_CATALOG_URL?.trim() || CatalogUpdateChecker.CHARACTER_CATALOG_URL;
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
        {
            throw new UserFacingError("The character catalog update address must use HTTPS.");
        }

        return url.toString();
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
