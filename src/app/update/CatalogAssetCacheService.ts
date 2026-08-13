import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { GitHubRequestUtils } from "#utils/GitHubRequestUtils.js";
import { HttpDownloadUtils } from "#utils/HttpDownloadUtils.js";
import { StringUtils } from "#utils/StringUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fse from "fs-extra";

export type CatalogAssetRepairProgress = Readonly<{
    processed: number;
    total: number;
    downloaded: number;
    currentFile: string | null;
}>;

export type CatalogAssetRepairResult = Readonly<{
    required: number;
    bundled: number;
    cached: number;
    downloaded: number;
}>;

type CatalogAssetCacheOptions = Readonly<{
    singularName: string;
    pluralName: string;
    accept: string;
    maximumSize: number;
    sourceDirectory: string;
    configuredBaseUrl: () => string | undefined;
    getCacheDirectory: () => string;
    getCachePath: (fileName: string) => string;
    isSafeFileName: (fileName: unknown) => fileName is string;
    isValidContents: (contents: Buffer) => boolean;
}>;

export class CatalogAssetCacheService {
    private readonly MAX_CONCURRENT_DOWNLOADS = 4;

    constructor(private readonly options: CatalogAssetCacheOptions) {}

    async installRequiredFiles(installedFiles: readonly string[], candidateFiles: readonly string[], catalogSourceUrl: URL) {
        const installed = new Set(this.validateAndDeduplicate(installedFiles).map(StringUtils.normalize));
        const required = this.validateAndDeduplicate(candidateFiles).filter((fileName) => !installed.has(StringUtils.normalize(fileName)));

        if (required.length === 0)
            return;

        await fse.ensureDir(this.options.getCacheDirectory());
        await this.downloadFiles(required, catalogSourceUrl);
    }

    async repairFiles(
        activeFiles: readonly string[],
        bundledFiles: readonly string[],
        catalogSourceUrl: URL,
        onProgress?: (progress: CatalogAssetRepairProgress) => void
    ): Promise<CatalogAssetRepairResult> {
        const required = this.validateAndDeduplicate(activeFiles);
        const bundled = new Set(this.validateAndDeduplicate(bundledFiles).map(StringUtils.normalize));
        const cachedFiles = required.filter((fileName) => !bundled.has(StringUtils.normalize(fileName)));

        let processed = 0;
        let downloaded = 0;

        onProgress?.({
            processed: 0,
            total: cachedFiles.length,
            downloaded: 0,
            currentFile: null
        });

        if (cachedFiles.length > 0)
        {
            await fse.ensureDir(this.options.getCacheDirectory());

            await this.downloadFiles(
                cachedFiles,
                catalogSourceUrl,
                (fileName, wasDownloaded) => {
                    processed++;

                    if (wasDownloaded)
                        downloaded++;

                    onProgress?.({
                        processed,
                        total: cachedFiles.length,
                        downloaded,
                        currentFile: fileName
                    });
                }
            );
        }

        return Object.freeze({
            required: required.length,
            bundled: required.length - cachedFiles.length,
            cached: cachedFiles.length - downloaded,
            downloaded
        });
    }

    private async downloadFiles(
        fileNames: readonly string[],
        catalogSourceUrl: URL,
        onProcessed?: (fileName: string, downloaded: boolean) => void
    ) {
        let nextIndex = 0;
        let failure: unknown;
        let failed = false;

        const worker = async () => {
            while (!failed)
            {
                const index = nextIndex++;
                if (index >= fileNames.length)
                    return;

                const fileName = fileNames[index];

                try
                {
                    const downloaded = await this.ensureFile(fileName, catalogSourceUrl);
                    onProcessed?.(fileName, downloaded);
                }
                catch (error)
                {
                    failed = true;
                    failure = error;
                }
            }
        };

        const workerCount = Math.min(this.MAX_CONCURRENT_DOWNLOADS, fileNames.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        if (failed)
            throw failure;
    }

    private async ensureFile(fileName: string, catalogSourceUrl: URL): Promise<boolean> {
        try
        {
            if (!this.options.isSafeFileName(fileName))
                throw new UserFacingError(`The catalog contains an invalid ${this.options.singularName} filename: ${fileName}.`);

            const destinationPath = this.options.getCachePath(fileName);
            if (await this.isValidCachedFile(destinationPath))
                return false;

            const sourceUrl = this.createAssetUrl(fileName, catalogSourceUrl);
            const response = await fetch(sourceUrl, {
                headers: GitHubRequestUtils.createDownloadHeaders(sourceUrl, this.options.accept),
                cache: "no-store",
                signal: AbortSignal.timeout(30_000)
            });

            if (!response.ok)
                throw this.createHttpError(response.status);

            const contents = await HttpDownloadUtils.readLimitedBody(
                response,
                this.options.maximumSize,
                `The downloaded ${this.options.singularName} is larger than the allowed limit.`,
                `The ${this.options.singularName} server returned an empty response.`
            );

            if (!this.options.isValidContents(contents))
                throw new UserFacingError(`The downloaded file is not a valid ${this.options.singularName}.`);

            await this.saveFile(destinationPath, contents);
            return true;
        }
        catch (error)
        {
            throw ErrorUtils.withContext(`The ${this.options.singularName} "${fileName}" could not be downloaded.`, error);
        }
    }

    private async isValidCachedFile(filePath: string): Promise<boolean> {
        try
        {
            const stats = await fse.stat(filePath);

            if (!stats.isFile() || stats.size === 0 || stats.size > this.options.maximumSize)
                return false;

            return this.options.isValidContents(await fse.readFile(filePath));
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return false;

            throw error;
        }
    }

    private async saveFile(destinationPath: string, contents: Buffer) {
        const directory = path.dirname(destinationPath);
        const temporaryPath = path.join(directory, `.${path.basename(destinationPath)}.${randomUUID()}.tmp`);

        try
        {
            await fse.writeFile(temporaryPath, contents, { flag: "wx" });
            await fse.move(temporaryPath, destinationPath, { overwrite: true });
        }
        finally
        {
            try
            {
                await fse.rm(temporaryPath, { force: true });
            }
            catch (error)
            {
                ApplicationLogger.warning(ApplicationLogSource.catalog, `Could not remove a temporary ${this.options.singularName}.`, error);
            }
        }
    }

    private createAssetUrl(fileName: string, catalogSourceUrl: URL): URL {
        const configuredBaseUrl = this.options.configuredBaseUrl()?.trim();
        let baseUrl: URL;

        try
        {
            baseUrl = configuredBaseUrl
                ? new URL(configuredBaseUrl)
                : new URL(this.options.sourceDirectory, catalogSourceUrl);
        }
        catch
        {
            throw new UserFacingError(`The ${this.options.singularName} update address is invalid.`);
        }

        if (baseUrl.protocol !== "https:")
            throw new UserFacingError(`The ${this.options.singularName} update address must use HTTPS.`);

        if (!baseUrl.pathname.endsWith("/"))
            baseUrl.pathname += "/";

        const query = configuredBaseUrl
            ? baseUrl.search
            : catalogSourceUrl.search;

        baseUrl.search = "";

        const assetUrl = new URL(encodeURIComponent(fileName), baseUrl);
        assetUrl.search = query;

        return assetUrl;
    }

    private createHttpError(status: number): UserFacingError {
        switch (status)
        {
            case 401:
            case 403:
                return new UserFacingError(`The ${this.options.singularName} request was not authorized. The temporary access link may have expired.`);
            case 404:
                return new UserFacingError(`The ${this.options.singularName} could not be found in the catalog repository.`);
            default:
                return new UserFacingError(`The ${this.options.singularName} server returned HTTP ${status}.`);
        }
    }

    private validateAndDeduplicate(fileNames: readonly string[]): string[] {
        const files = new Map<string, string>();

        for (const fileName of fileNames)
        {
            if (!this.options.isSafeFileName(fileName))
                throw new UserFacingError(`The catalog contains an invalid ${this.options.singularName} filename: ${fileName}.`);

            files.set(StringUtils.normalize(fileName), fileName);
        }

        return [...files.values()];
    }
}
