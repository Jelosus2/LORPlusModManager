import type { CharacterCatalog, CharacterSkin, CatalogIconRepairProgress, CatalogIconRepairResult } from "../../shared/characters.js";

import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { GitHubRequestUtils } from "#utils/GitHubRequestUtils.js";
import { HttpDownloadUtils } from "#utils/HttpDownloadUtils.js";
import { StringUtils } from "#utils/StringUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export class CatalogIconService {
    static readonly MAX_CATALOG_ICON_SIZE = 1 * 1024 ** 2;
    private static readonly MAX_CONCURRENT_DOWNLOADS = 4;
    private static readonly PNG_SIGNATURE = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
    ]);

    async installRequiredIcons(installedCatalog: CharacterCatalog, candidateCatalog: CharacterCatalog, catalogSourceUrl: URL) {
        const iconFiles = this.findRequiredIcons(installedCatalog, candidateCatalog);
        if (iconFiles.length === 0)
            return;

        await fse.ensureDir(Paths.getCachedCharacterIconsPath());
        await this.downloadIcons(iconFiles, catalogSourceUrl);
    }

    async repairCatalogIcons(
        activeCatalog: CharacterCatalog,
        bundledCatalog: CharacterCatalog,
        catalogSourceUrl: URL,
        onProgress?: (progress: CatalogIconRepairProgress) => void
    ): Promise<CatalogIconRepairResult> {
        const requiredIcons = this.getCatalogIconFiles(activeCatalog);
        const bundledIcons = new Set(this.getCatalogIconFiles(bundledCatalog).map(StringUtils.normalize));
        const cachedIconsToCheck = requiredIcons.filter((iconFile) => !bundledIcons.has(StringUtils.normalize(iconFile)));
        const bundledCount = requiredIcons.length - cachedIconsToCheck.length;

        let processed = 0;
        let downloaded = 0;

        onProgress?.({
            processed: 0,
            total: cachedIconsToCheck.length,
            downloaded: 0,
            currentIcon: null
        });

        await this.downloadIcons(
            cachedIconsToCheck,
            catalogSourceUrl,
            (iconFile, wasDownloaded) => {
                processed++;

                if (wasDownloaded)
                    downloaded++;

                onProgress?.({
                    processed,
                    total: cachedIconsToCheck.length,
                    downloaded,
                    currentIcon: iconFile
                });
            }
        );

        return Object.freeze({
            required: requiredIcons.length,
            bundled: bundledCount,
            cached: cachedIconsToCheck.length - downloaded,
            downloaded
        });
    }

    private async downloadIcons(iconFiles: readonly string[], catalogSourceUrl: URL, onIconProcessed?: (iconFile: string, downloaded: boolean) => void) {
        let nextIndex = 0;
        let failure: unknown;
        let failed = false;

        const worker = async () => {
            while (!failed)
            {
                const index = nextIndex++;
                if (index >= iconFiles.length)
                    return;

                const iconFile = iconFiles[index];

                try
                {
                    const downloaded = await this.ensureIcon(iconFile, catalogSourceUrl);
                    onIconProcessed?.(iconFile, downloaded);
                }
                catch (error)
                {
                    failed = true;
                    failure = error;
                }
            }
        };

        const workerCount = Math.min(CatalogIconService.MAX_CONCURRENT_DOWNLOADS, iconFiles.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        if (failed)
            throw failure;
    }

    private async ensureIcon(iconFile: string, catalogSourceUrl: URL): Promise<boolean> {
        try
        {
            if (!Paths.isSafeCatalogIconName(iconFile))
                throw new UserFacingError(`The catalog contains an invalid icon filename: ${iconFile}.`);

            const destinationPath = Paths.getCachedCharacterIconPath(iconFile);
            if (await this.isValidCacheIcon(destinationPath))
                return false;

            const sourceUrl = this.createIconUrl(iconFile, catalogSourceUrl);
            const response = await fetch(sourceUrl, {
                headers: GitHubRequestUtils.createDownloadHeaders(sourceUrl, "image/png"),
                cache: "no-store",
                signal: AbortSignal.timeout(30_000)
            });

            if (!response.ok)
                throw this.createHttpError(response.status);

            const contents = await HttpDownloadUtils.readLimitedBody(
                response,
                CatalogIconService.MAX_CATALOG_ICON_SIZE,
                "The downloaded icon is larger than the 1 MB limit.",
                "The character icon server returned an empty response."
            );

            if (!this.hasPngSignature(contents))
                throw new UserFacingError("The downloaded file is not a valid PNG image.");

            await this.saveIcon(destinationPath, contents);
            return true;
        }
        catch (error)
        {
            throw ErrorUtils.withContext(`The character icon "${iconFile}" could not be downloaded.`, error);
        }
    }

    private async saveIcon(destinationPath: string, contents: Buffer) {
        const directory = path.dirname(destinationPath);
        const tempPath = path.join(directory, `.${path.basename(destinationPath)}.${randomUUID()}.tmp`);

        try
        {
            await fse.writeFile(tempPath, contents, { flag: "wx" });
            await fse.move(tempPath, destinationPath, { overwrite: true });
        }
        finally
        {
            try
            {
                await fse.rm(tempPath, { force: true });
            }
            catch (error)
            {
                ApplicationLogger.warning(ApplicationLogSource.catalog, "Could not remove a temporary character icon.", error);
            }
        }
    }

    private async isValidCacheIcon(filePath: string): Promise<boolean> {
        try
        {
            const stats = await fse.stat(filePath);
            if (!stats.isFile() || stats.size > CatalogIconService.MAX_CATALOG_ICON_SIZE)
                return false;

            const contents = await fse.readFile(filePath);
            return this.hasPngSignature(contents);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return false;

            throw error;
        }
    }

    private createIconUrl(iconFile: string, catalogSourceUrl: URL): URL {
        const configuredBaseUrl = process.env.LORPLUS_CATALOG_ICON_BASE_URL?.trim();
        let baseUrl: URL;

        try
        {
            baseUrl = configuredBaseUrl
                ? new URL(configuredBaseUrl)
                : new URL("../ui/assets/character_icons/", catalogSourceUrl);
        }
        catch
        {
            throw new UserFacingError("The character icon update address is invalid.");
        }

        if (baseUrl.protocol !== "https:")
            throw new UserFacingError("The character icon update address must use HTTPS.");
        if (!baseUrl.pathname.endsWith("/"))
            baseUrl.pathname += "/";

        const query = configuredBaseUrl
            ? baseUrl.search
            : catalogSourceUrl.search;

        baseUrl.search = "";

        const iconUrl = new URL(encodeURIComponent(iconFile), baseUrl);
        iconUrl.search = query;

        return iconUrl;
    }

    private getCatalogIconFiles(catalog: CharacterCatalog): string[] {
        const icons = new Map<string, string>();

        for (const entry of catalog.characters)
        {
            if (!Paths.isSafeCatalogIconName(entry.iconFile))
                throw new UserFacingError(`The catalog contains an invalid icon filename: ${entry.iconFile}.`);

            icons.set(StringUtils.normalize(entry.iconFile), entry.iconFile);
        }

        return [...icons.values()];
    }

    private findRequiredIcons(installedCatalog: CharacterCatalog, candidateCatalog: CharacterCatalog): string[] {
        const installedEntries = new Map(installedCatalog.characters.map((entry) => [this.getCharacterIdentity(entry), entry]));
        const requiredIcons = new Map<string, string>();

        for (const entry of candidateCatalog.characters)
        {
            const previousEntry = installedEntries.get(this.getCharacterIdentity(entry));
            const needsIcon = !previousEntry || StringUtils.normalize(previousEntry.iconFile) !== StringUtils.normalize(entry.iconFile);

            if (needsIcon)
                requiredIcons.set(StringUtils.normalize(entry.iconFile), entry.iconFile);
        }

        return [...requiredIcons.values()];
    }

    private createHttpError(status: number): UserFacingError {
        switch (status)
        {
            case 401:
            case 403:
                return new UserFacingError("The icon request was not authorized. The temporary access link may have expired.");
            case 404:
                return new UserFacingError("The icon could not be found in the catalog repository.");
            default:
                return new UserFacingError(`The character icon server returned HTTP ${status}.`);
        }
    }

    private hasPngSignature(contents: Buffer): boolean {
        return (
            contents.length >= CatalogIconService.PNG_SIGNATURE.length &&
            contents.subarray(0, CatalogIconService.PNG_SIGNATURE.length).equals(CatalogIconService.PNG_SIGNATURE)
        );
    }

    private getCharacterIdentity(entry: CharacterSkin): string {
        return [
            StringUtils.normalize(entry.skin2dId),
            StringUtils.normalize(entry.variantId ?? "")
        ].join("\0");
    }
}

export const catalogIconService = new CatalogIconService();
