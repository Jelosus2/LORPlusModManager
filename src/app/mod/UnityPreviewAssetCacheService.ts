import type { ExtractedUnityPreviewAsset, UnityPreviewAssetType, UnitySpriteGeometry } from "./UnityWorkerClient.js";
import type { ResolvedGameAssetBundle } from "#game/GameAssetBundleResolver.js";

import { gameAssetBundleResolver } from "#game/GameAssetBundleResolver.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { UnityWorkerClient } from "./UnityWorkerClient.js";
import { StringUtils } from "#utils/StringUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type UnityPreviewAssetRequest = Readonly<{
    type: UnityPreviewAssetType;
    name: string;
}>;

export type CachedUnityPreviewAsset = Readonly<{
    key: string;
    bundleName: string;
    versionHash: string;
    type: UnityPreviewAssetType;
    name: string;
    filePath: string;
    size: number;
    sprite?: UnitySpriteGeometry;
}>;

type PreviewAssetMetadata = Readonly<{
    formatVersion: 1;
    key: string;
    bundleName: string;
    versionHash: string;
    type: UnityPreviewAssetType;
    name: string;
    size: number;
    sprite?: UnitySpriteGeometry;
}>;

export class UnityPreviewAssetCacheService {
    private readonly FORMAT_VERSION = 1;
    private readonly MAXIMUM_REQUESTS = 64;
    private readonly MAXIMUM_ASSET_NAME_LENGTH = 256;
    private readonly MAXIMUM_METADATA_SIZE = 16 * 1024;
    private readonly worker = new UnityWorkerClient();
    private readonly pending = new Map<string, Promise<readonly CachedUnityPreviewAsset[]>>();
    private readonly PNG_SIGNATURE = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a
    ]);
    static readonly MAXIMUM_IMAGE_SIZE = 128 * 1024 ** 2;

    ensureBundleAssets(bundleName: string, rawRequests: readonly UnityPreviewAssetRequest[]): Promise<readonly CachedUnityPreviewAsset[]> {
        if (!Paths.isSafeGameAssetBundleName(bundleName))
            throw new UserFacingError("The requested game asset bundle name is invalid.");

        const requests = this.validateAndDeduplicateRequests(rawRequests);
        const operationKey = JSON.stringify([
            StringUtils.normalize(bundleName),
            requests.map((request) => this.getRequestIdentity(request)).sort()
        ]);

        const existing = this.pending.get(operationKey);
        if (existing)
            return existing;

        const operation = this.ensureBundleAssetsInternal(bundleName, requests).finally(() => {
            this.pending.delete(operationKey);
        });

        this.pending.set(operationKey, operation);
        return operation;
    }

    private async ensureBundleAssetsInternal(bundleName: string, requests: readonly UnityPreviewAssetRequest[]): Promise<readonly CachedUnityPreviewAsset[]> {
        const candidates = await gameAssetBundleResolver.findConfiguredCandidates(bundleName);
        if (candidates.length === 0)
            throw new UserFacingError(`The original game bundle "${bundleName}" is not available. Start or update the game once so it can download the required files.`);

        const failures: unknown[] = [];

        for (const candidate of candidates)
        {
            try
            {
                return await this.ensureFromCandidate(candidate, requests);
            }
            catch (error)
            {
                failures.push(error);
            }
        }

        throw ErrorUtils.withContext(
            `The original assets required from "${bundleName}" could not be prepared.`,
            new AggregateError(failures),
            "None of the cached game-bundle versions contained all the requested assets."
        );
    }

    private async ensureFromCandidate(
        candidate: ResolvedGameAssetBundle,
        requests: readonly UnityPreviewAssetRequest[]
    ): Promise<readonly CachedUnityPreviewAsset[]> {
        const cachedAssets = new Map<string, CachedUnityPreviewAsset>();
        const missing: UnityPreviewAssetRequest[] = [];

        for (const request of requests)
        {
            const cached = await this.loadCachedAsset(candidate, request);

            if (cached)
                cachedAssets.set(this.getRequestIdentity(request), cached);
            else
                missing.push(request);
        }

        if (missing.length > 0)
            await this.extractMissingAssets(candidate, missing);

        const result: CachedUnityPreviewAsset[] = [];

        for (const request of requests)
        {
            const identity = this.getRequestIdentity(request);
            const cached = cachedAssets.get(identity) ?? await this.loadCachedAsset(candidate, request);

            if (!cached)
                throw new Error(`The extracted preview asset "${request.name}" could not be validated.`);

            result.push(cached);
        }

        return Object.freeze(result);
    }

    private async extractMissingAssets(candidate: ResolvedGameAssetBundle, requests: readonly UnityPreviewAssetRequest[]): Promise<void> {
        const bundleCachePath = Paths.getUnityPreviewBundleCachePath(candidate.bundleName, candidate.versionHash);
        const stagingPath = path.join(bundleCachePath, `.staging-${randomUUID()}`);
        const temporaryEntries: string[] = [];

        await fse.ensureDir(bundleCachePath);

        try
        {
            const selections = requests.map((request) => ({
                ...request,
                outputName: `${this.createAssetKey(request)}.png`
            }));

            const extraction = await this.worker.extractPreviewAssets(candidate.filePath, stagingPath, selections);
            const writtenByOutputName = new Map(extraction.written.map((asset) => [asset.outputName, asset]));

            if (writtenByOutputName.size !== selections.length)
                throw new Error("The Unity worker did not extract every requested preview asset.");

            for (const selection of selections)
            {
                const written = writtenByOutputName.get(selection.outputName);

                if (!written || written.type !== selection.type || written.name !== selection.name)
                    throw new Error(`The Unity worker returned the wrong result for "${selection.name}".`);

                await this.publishAsset(candidate, written, stagingPath, temporaryEntries);
            }
        }
        finally
        {
            await this.removeTemporaryPath(stagingPath);

            for (const temporaryEntry of temporaryEntries)
                await this.removeTemporaryPath(temporaryEntry);
        }
    }

    private async publishAsset(
        candidate: ResolvedGameAssetBundle,
        written: ExtractedUnityPreviewAsset,
        stagingPath: string,
        temporaryEntries: string[]
    ): Promise<void> {
        if (written.size <= 0 || written.size > UnityPreviewAssetCacheService.MAXIMUM_IMAGE_SIZE)
            throw new Error(`The extracted preview asset "${written.name}" has an invalid size.`);

        const request = {
            type: written.type,
            name: written.name
        } satisfies UnityPreviewAssetRequest;

        const key = this.createAssetKey(request);
        const sourcePath = path.join(stagingPath, written.outputName);
        const sourceStats = await fse.lstat(sourcePath);

        if (sourceStats.isSymbolicLink() || !sourceStats.isFile() || sourceStats.size !== written.size || !await this.hasPngSignature(sourcePath))
            throw new Error(`The extracted preview asset "${written.name}" is not a valid PNG file.`);

        const bundleCachePath = Paths.getUnityPreviewBundleCachePath(candidate.bundleName, candidate.versionHash);
        const destinationPath = path.join(bundleCachePath, key);
        const temporaryPath = path.join(bundleCachePath, `.${key}.${randomUUID()}.tmp`);

        temporaryEntries.push(temporaryPath);
        await fse.ensureDir(temporaryPath);

        const metadata: PreviewAssetMetadata = {
            formatVersion: this.FORMAT_VERSION,
            key,
            bundleName: candidate.bundleName,
            versionHash: candidate.versionHash,
            type: written.type,
            name: written.name,
            size: written.size,
            ...(written.sprite
                ? {
                    sprite: written.sprite
                }
                : {})
        };

        await fse.move(sourcePath, path.join(temporaryPath, "asset.png"));
        await fse.writeFile(path.join(temporaryPath, "metadata.json"), JSON.stringify(metadata), { encoding: "utf-8", flag: "wx" });
        await fse.move(temporaryPath, destinationPath, { overwrite: true });

        const temporaryIndex = temporaryEntries.indexOf(temporaryPath);
        if (temporaryIndex >= 0)
            temporaryEntries.splice(temporaryIndex, 1);
    }

    private async loadCachedAsset(candidate: ResolvedGameAssetBundle, request: UnityPreviewAssetRequest): Promise<CachedUnityPreviewAsset | null> {
        const key = this.createAssetKey(request);
        const entryPath = path.join(Paths.getUnityPreviewBundleCachePath(candidate.bundleName, candidate.versionHash), key);
        const metadataPath = path.join(entryPath, "metadata.json");
        const filePath = path.join(entryPath, "asset.png");

        try
        {
            const metadataStats = await fse.lstat(metadataPath);

            if (
                metadataStats.isSymbolicLink() ||
                !metadataStats.isFile() ||
                metadataStats.size === 0 ||
                metadataStats.size > this.MAXIMUM_METADATA_SIZE
            )
            {
                return null;
            }

            const rawMetadata: unknown = JSON.parse(await fse.readFile(metadataPath, "utf-8"));
            const metadata = this.parseMetadata(rawMetadata);

            if (
                !metadata ||
                metadata.key !== key ||
                metadata.bundleName !== candidate.bundleName ||
                metadata.versionHash !== candidate.versionHash ||
                metadata.type !== request.type ||
                metadata.name !== request.name
            )
            {
                return null;
            }

            const fileStats = await fse.lstat(filePath);

            if (
                fileStats.isSymbolicLink() ||
                !fileStats.isFile() ||
                fileStats.size !== metadata.size ||
                fileStats.size === 0 ||
                fileStats.size > UnityPreviewAssetCacheService.MAXIMUM_IMAGE_SIZE ||
                !await this.hasPngSignature(filePath)
            )
            {
                return null;
            }

            return Object.freeze({
                key,
                bundleName: metadata.bundleName,
                versionHash: metadata.versionHash,
                type: metadata.type,
                name: metadata.name,
                filePath,
                size: metadata.size,
                ...(metadata.sprite
                    ? {
                        sprite: metadata.sprite
                    }
                    : {})
            });
        }
        catch (error)
        {
            if (error instanceof SyntaxError || (TypeCheck.isNodeError(error) && ["ENOENT", "ENOTDIR"].includes(error.code ?? "")))
                return null;

            throw error;
        }
    }

    private parseMetadata(value: unknown): PreviewAssetMetadata | null {
        if (
            !TypeCheck.isRecord(value) ||
            value.formatVersion !== this.FORMAT_VERSION ||
            !TypeCheck.isValidString(value.key, 64) ||
            !/^[0-9a-f]{64}$/i.test(value.key) ||
            !Paths.isSafeGameAssetBundleName(value.bundleName) ||
            !Paths.isSafeGameAssetBundleVersionHash(value.versionHash) ||
            (value.type !== "Texture2D" && value.type !== "Sprite") ||
            !this.isValidAssetName(value.name) ||
            !TypeCheck.isValidInteger(value.size, true) ||
            value.size <= 0 ||
            value.size > UnityPreviewAssetCacheService.MAXIMUM_IMAGE_SIZE
        )
        {
            return null;
        }

        if (value.type === "Sprite")
        {
            if (!this.isSpriteGeometry(value.sprite))
                return null;
        }
        else if (value.sprite !== undefined)
        {
            return null;
        }

        return value as PreviewAssetMetadata;
    }

    private async hasPngSignature(filePath: string): Promise<boolean> {
        const file = await open(filePath, "r");

        try
        {
            const signature = Buffer.alloc(this.PNG_SIGNATURE.length);
            const result = await file.read(signature, 0, signature.length, 0);

            return result.bytesRead === signature.length && signature.equals(this.PNG_SIGNATURE);
        }
        finally
        {
            await file.close();
        }
    }

    private async removeTemporaryPath(filePath: string): Promise<void> {
        try
        {
            await fse.rm(filePath, { recursive: true, force: true });
        }
        catch (error)
        {
            ApplicationLogger.warning(ApplicationLogSource.modLibrary, "Could not remove a temporary preview-cache entry.", error);
        }
    }

    private validateAndDeduplicateRequests(requests: readonly UnityPreviewAssetRequest[]): readonly UnityPreviewAssetRequest[] {
        if (!TypeCheck.isValidArray(requests, this.MAXIMUM_REQUESTS))
            throw new UserFacingError("No valid preview assets were requested.");

        const unique = new Map<string, UnityPreviewAssetRequest>();

        for (const request of requests)
        {
            if (!TypeCheck.isRecord(request) || (request.type !== "Texture2D" && request.type !== "Sprite") || !this.isValidAssetName(request.name))
                throw new UserFacingError("A requested preview asset is invalid.");

            unique.set(this.getRequestIdentity(request), Object.freeze({
                type: request.type,
                name: request.name
            }));
        }

        return Object.freeze([...unique.values()]);
    }

    private isSpriteGeometry(value: unknown): value is UnitySpriteGeometry {
        return (
            TypeCheck.isRecord(value) &&
            TypeCheck.isValidInteger(value.pixelWidth, true) &&
            value.pixelWidth > 0 &&
            TypeCheck.isValidInteger(value.pixelHeight, true) &&
            value.pixelHeight > 0 &&
            typeof value.pixelsPerUnit === "number" &&
            Number.isFinite(value.pixelsPerUnit) &&
            value.pixelsPerUnit > 0 &&
            TypeCheck.isRecord(value.pivot) &&
            typeof value.pivot.x === "number" &&
            Number.isFinite(value.pivot.x) &&
            typeof value.pivot.y === "number" &&
            Number.isFinite(value.pivot.y)
        );
    }

    private createAssetKey(request: UnityPreviewAssetRequest): string {
        return createHash("sha256")
            .update(request.type)
            .update("\0")
            .update(StringUtils.normalize(request.name))
            .digest("hex");
    }

    private getRequestIdentity(request: UnityPreviewAssetRequest): string {
        return JSON.stringify([
            request.type,
            StringUtils.normalize(request.name)
        ]);
    }

    private isValidAssetName(value: unknown): value is string {
        return TypeCheck.isValidString(value, this.MAXIMUM_ASSET_NAME_LENGTH) && !/[\u0000-\u001f\u007f]/.test(value);
    }
}

export const unityPreviewAssetCache = new UnityPreviewAssetCacheService();
