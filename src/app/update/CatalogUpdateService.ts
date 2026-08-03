import type { CheckedUpdateVersions, UpdateChecker } from "./UpdateChecker.js";
import type { CharacterCatalog } from "../../shared/characters.js";
import type { UpdateComponent } from "../../shared/updates.js";

import { CharacterCatalogService, characterCatalog } from "#utils/CharacterCatalogService.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { VersionUtils } from "#utils/VersionUtils.js";

type DownloadedCatalog = {
    catalog: CharacterCatalog;
    contents: string;
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

        return characterCatalog.installCatalogContents(downloaded.contents);

    }

    private async downloadLatest(): Promise<DownloadedCatalog> {
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

        const contents = await this.readLimitedBody(response);

        try
        {
            const catalog = characterCatalog.parseCatalogContents(contents);
            VersionUtils.validate(catalog.version, "downloaded character catalog version");

            return {
                catalog,
                contents
            };
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The downloaded character catalog could not be validated.", error);
        }
    }

    private async readLimitedBody(response: Response): Promise<string> {
        const contentLength = response.headers.get("content-length");
        if (contentLength !== null)
        {
            const declaredSize = Number(contentLength);
            if (Number.isFinite(declaredSize) && declaredSize > CharacterCatalogService.MAX_CATALOG_SIZE)
                throw new UserFacingError("The downloaded character catalog is unexpectedly large.");
        }

        if (!response.body)
            throw new UserFacingError("The character catalog server returned an empty response.");

        const reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        try
        {
            while (true)
            {
                const { done, value } = await reader.read();

                if (done)
                    break;

                totalBytes += value.byteLength;
                if (totalBytes > CharacterCatalogService.MAX_CATALOG_SIZE)
                {
                    await reader.cancel();
                    throw new UserFacingError("The downloaded character catalog is unexpectedly large.");
                }

                chunks.push(Buffer.from(value));
            }
        }
        finally
        {
            reader.releaseLock();
        }

        return Buffer.concat(chunks, totalBytes).toString("utf-8");
    }

    private getCatalogUrl(): string {
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

export const catalogUpdateService = new CatalogUpdateService();
