import type { ExtractedUnityPreviewAsset, UnityPreviewAssetType, UnitySpriteGeometry, UnityAnimatorRuntimeFile } from "./UnityWorkerClient.js";
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

export type CachedAnimatorRuntimePackage = Readonly<{
    key: string;
    bundleName: string;
    versionHash: string;
    locator: string;
    formatVersion: number;
    entryPath: string;
    files: readonly UnityAnimatorRuntimeFile[];
}>;

type AnimatorRuntimeMetadata = Readonly<{
    metadataVersion: 1;
    kind: "animator-runtime";
    key: string;
    bundleName: string;
    versionHash: string;
    locator: string;
    runtimeFormatVersion: 20;
    files: readonly UnityAnimatorRuntimeFile[];
}>;

export type ResolvedAnimatorRuntimeFile = Readonly<{
    filePath: string;
    size: number;
    sha256: string;
}>;

export class UnityPreviewAssetCacheService {
    private readonly FORMAT_VERSION = 1;
    private readonly MAXIMUM_REQUESTS = 64;
    private readonly MAXIMUM_ASSET_NAME_LENGTH = 256;
    private readonly MAXIMUM_METADATA_SIZE = 16 * 1024;
    private readonly ANIMATOR_RUNTIME_FORMAT_VERSION = 20;
    private readonly MAXIMUM_RUNTIME_METADATA_SIZE = 2 * 1024 * 1024;
    private readonly MAXIMUM_RUNTIME_PACKAGE_SIZE = 2 * 1024 ** 3;
    private readonly worker = new UnityWorkerClient();
    private readonly pending = new Map<string, Promise<readonly CachedUnityPreviewAsset[]>>();
    private readonly pendingAnimatorRuntimes = new Map<string, Promise<CachedAnimatorRuntimePackage>>();
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

    ensureAnimatorRuntime(bundleName: string, locator: string): Promise<CachedAnimatorRuntimePackage> {
        if (!Paths.isSafeGameAssetBundleName(bundleName) || !Paths.isSafeGameAssetBundleName(locator))
            throw new UserFacingError("The requested Animator preview package is invalid.");

        const operationKey = JSON.stringify([
            StringUtils.normalize(bundleName),
            StringUtils.normalize(locator),
            this.ANIMATOR_RUNTIME_FORMAT_VERSION
        ]);

        const existing = this.pendingAnimatorRuntimes.get(operationKey);
        if (existing)
            return existing;

        const operation = this.ensureAnimatorRuntimeInternal(bundleName, locator).finally(() => {
            this.pendingAnimatorRuntimes.delete(operationKey);
        });

        this.pendingAnimatorRuntimes.set(operationKey, operation);
        return operation;
    }

    async resolveAnimatorRuntimeFile(bundleName: string, versionHash: string, key: string, relativePath: string): Promise<ResolvedAnimatorRuntimeFile | null> {
        if (
            !Paths.isSafeGameAssetBundleName(bundleName) ||
            !Paths.isSafeGameAssetBundleVersionHash(versionHash) ||
            !/^[0-9a-f]{64}$/i.test(key) ||
            !this.isAnimatorRuntimeFilePath(relativePath)
        )
        {
            return null;
        }

        const configuredBundleRoot = Paths.getUnityPreviewBundleCachePath(bundleName, versionHash);
        const configuredEntryPath = path.join(configuredBundleRoot, key);

        try
        {
            const configuredEntryStats = await fse.lstat(configuredEntryPath);
            if (!configuredEntryStats.isDirectory() || configuredEntryStats.isSymbolicLink())
                return null;

            const bundleRoot = await fse.realpath(configuredBundleRoot);
            const entryPath = await fse.realpath(configuredEntryPath);

            if (!Paths.isSubpath(bundleRoot, entryPath))
                return null;

            const metadataPath = path.join(entryPath, "metadata.json");
            const metadataStats = await fse.lstat(metadataPath);

            if (metadataStats.isSymbolicLink() || !metadataStats.isFile() || metadataStats.size === 0 || metadataStats.size > this.MAXIMUM_RUNTIME_METADATA_SIZE)
                return null;

            const rawMetadata: unknown = JSON.parse(await fse.readFile(metadataPath, "utf-8"));
            const metadata = this.parseAnimatorRuntimeMetadata(rawMetadata);

            if (
                !metadata ||
                metadata.bundleName !== bundleName ||
                metadata.versionHash !== versionHash ||
                metadata.key !== key
            )
            {
                return null;
            }

            const file = metadata.files.find((candidate) => candidate.path === relativePath);
            if (!file)
                return null;

            const configuredFilePath = this.getAnimatorRuntimeFilePath(entryPath, relativePath);
            const configuredFileStats = await fse.lstat(configuredFilePath);

            if (!configuredFileStats.isFile() || configuredFileStats.isSymbolicLink() || configuredFileStats.size !== file.size)
                return null;

            const filePath = await fse.realpath(configuredFilePath);
            if (!Paths.isSubpath(entryPath, filePath))
                return null;

            return Object.freeze({
                filePath,
                size: file.size,
                sha256: file.sha256
            });
        }
        catch (error)
        {
            if (error instanceof SyntaxError || (TypeCheck.isNodeError(error) && ["ENOENT", "ENOTDIR"].includes(error.code ?? "")))
                return null;

            throw error;
        }
    }

    private async ensureBundleAssetsInternal(bundleName: string, requests: readonly UnityPreviewAssetRequest[]): Promise<readonly CachedUnityPreviewAsset[]> {
        return this.tryConfigureCandidates(
            bundleName,
            (candidate) => this.ensureFromCandidate(candidate, requests),
            `The original assets required from "${bundleName}" could not be prepared.`,
            "None of the cached game-bundle versions contained all the requested assets."
        );
    }

    private async ensureAnimatorRuntimeInternal(bundleName: string, locator: string): Promise<CachedAnimatorRuntimePackage> {
        return this.tryConfigureCandidates(
            bundleName,
            (candidate) => this.ensureAnimatorRuntimeFromCandidate(candidate, locator),
            `The Animator preview package required from "${bundleName}" could not be prepared.`,
            "None of the cached game-bundle versions contained a usable Animator runtime."
        );
    }

    private async tryConfigureCandidates<T>(
        bundleName: string,
        operation: (candidate: ResolvedGameAssetBundle) => Promise<T>,
        failureMessage: string,
        fallbackMessage: string
    ): Promise<T> {
        const candidates = await gameAssetBundleResolver.findConfiguredCandidates(bundleName);
        if (candidates.length === 0)
            throw new UserFacingError(`The original game bundle "${bundleName}" is not available. Start or update the game once so it can download the required files.`);

        const failures: unknown[] = [];

        for (const candidate of candidates)
        {
            try
            {
                return await operation(candidate);
            }
            catch (error)
            {
                failures.push(error);
            }
        }

        throw ErrorUtils.withContext(failureMessage, new AggregateError(failures), fallbackMessage);
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

    private async ensureAnimatorRuntimeFromCandidate(candidate: ResolvedGameAssetBundle, locator: string): Promise<CachedAnimatorRuntimePackage> {
        const cached = await this.loadCachedAnimatorRuntime(candidate, locator);
        if (cached)
            return cached;

        await this.extractAnimatorRuntime(candidate, locator);

        const extracted = await this.loadCachedAnimatorRuntime(candidate, locator);
        if (!extracted)
            throw new Error("The extracted Animator runtime package could not be validated.");

        return extracted;
    }

    private async extractMissingAssets(candidate: ResolvedGameAssetBundle, requests: readonly UnityPreviewAssetRequest[]) {
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

    private async extractAnimatorRuntime(candidate: ResolvedGameAssetBundle, locator: string) {
        const bundleCachePath = Paths.getUnityPreviewBundleCachePath(candidate.bundleName, candidate.versionHash);
        const key = this.createAnimatorRuntimeKey(locator);
        const stagingPath = path.join(bundleCachePath, `.staging-animator-${randomUUID()}`);
        const temporaryPath = path.join(bundleCachePath, `.${key}.${randomUUID()}.tmp`);
        const destinationPath = path.join(bundleCachePath, key);

        await fse.ensureDir(bundleCachePath);

        try
        {
            const runtime = await this.worker.prepareAnimatorRuntime(
                candidate.filePath,
                candidate.bundleName,
                stagingPath,
                locator,
                candidate.unityDefaultResourcesPath
            );

            if (runtime.bundleName !== candidate.bundleName || runtime.locator !== locator || runtime.formatVersion !== this.ANIMATOR_RUNTIME_FORMAT_VERSION)
                throw new Error("The Unity worker prepared the wrong Animator runtime package.");

            await this.validateRuntimeFiles(stagingPath, runtime.files);

            const metadata: AnimatorRuntimeMetadata = {
                metadataVersion: 1,
                kind: "animator-runtime",
                key,
                bundleName: candidate.bundleName,
                versionHash: candidate.versionHash,
                locator,
                runtimeFormatVersion: this.ANIMATOR_RUNTIME_FORMAT_VERSION,
                files: runtime.files
            };

            await fse.writeFile(path.join(stagingPath, "metadata.json"), JSON.stringify(metadata), { encoding: "utf-8", flag: "wx" });
            await fse.move(stagingPath, temporaryPath);
            await fse.move(temporaryPath, destinationPath, { overwrite: true });
        }
        finally
        {
            await this.removeTemporaryPath(stagingPath);
            await this.removeTemporaryPath(temporaryPath);
        }
    }

    private async publishAsset(
        candidate: ResolvedGameAssetBundle,
        written: ExtractedUnityPreviewAsset,
        stagingPath: string,
        temporaryEntries: string[]
    ) {
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
            if (metadataStats.isSymbolicLink() || !metadataStats.isFile() || metadataStats.size === 0 || metadataStats.size > this.MAXIMUM_METADATA_SIZE)
                return null;

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

    private async loadCachedAnimatorRuntime(candidate: ResolvedGameAssetBundle, locator: string): Promise<CachedAnimatorRuntimePackage | null> {
        const key = this.createAnimatorRuntimeKey(locator);
        const entryPath = path.join(Paths.getUnityPreviewBundleCachePath(candidate.bundleName, candidate.versionHash), key);
        const metadataPath = path.join(entryPath, "metadata.json");

        try
        {
            const metadataStats = await fse.lstat(metadataPath);
            if (metadataStats.isSymbolicLink() || !metadataStats.isFile() || metadataStats.size === 0 || metadataStats.size > this.MAXIMUM_RUNTIME_METADATA_SIZE)
                return null;

            const rawMetadata: unknown = JSON.parse(await fse.readFile(metadataPath, "utf-8"));
            const metadata = this.parseAnimatorRuntimeMetadata(rawMetadata);

            if (!metadata ||
                metadata.key !== key ||
                metadata.bundleName !== candidate.bundleName ||
                metadata.versionHash !== candidate.versionHash ||
                metadata.locator !== locator
            )
            {
                return null;
            }

            await this.validateRuntimeFiles(entryPath, metadata.files);

            return Object.freeze({
                key,
                bundleName: metadata.bundleName,
                versionHash: metadata.versionHash,
                locator: metadata.locator,
                formatVersion: metadata.runtimeFormatVersion,
                entryPath,
                files: Object.freeze(metadata.files.map((file) => Object.freeze({ ...file })))
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

    private async removeTemporaryPath(filePath: string) {
        try
        {
            await fse.rm(filePath, { recursive: true, force: true });
        }
        catch (error)
        {
            ApplicationLogger.warning(ApplicationLogSource.modLibrary, "Could not remove a temporary preview-cache entry.", error);
        }
    }

    private async hashFile(filePath: string): Promise<string> {
        const file = await open(filePath, "r");
        const digest = createHash("sha256");
        const buffer = Buffer.allocUnsafe(1024 * 1024);

        try
        {
            let position = 0;

            while (true)
            {
                const result = await file.read(buffer, 0, buffer.length, position);
                if (result.bytesRead === 0)
                    break;

                digest.update(buffer.subarray(0, result.bytesRead));
                position += result.bytesRead;
            }

            return digest.digest("hex");
        }
        finally
        {
            await file.close();
        }
    }

    private parseAnimatorRuntimeMetadata(value: unknown): AnimatorRuntimeMetadata | null {
        if (
            !TypeCheck.isRecord(value) ||
            value.metadataVersion !== 1 ||
            value.kind !== "animator-runtime" ||
            !TypeCheck.isValidString(value.key, 64) ||
            !/^[0-9a-f]{64}$/i.test(value.key) ||
            !Paths.isSafeGameAssetBundleName(value.bundleName) ||
            !Paths.isSafeGameAssetBundleVersionHash(value.versionHash) ||
            !Paths.isSafeGameAssetBundleName(value.locator) ||
            value.runtimeFormatVersion !== this.ANIMATOR_RUNTIME_FORMAT_VERSION ||
            !TypeCheck.isValidArray(value.files, 1024) ||
            value.files.length === 0 ||
            !value.files.every((file) => this.isAnimatorRuntimeFile(file))
        )
        {
            return null;
        }

        const files = value.files as UnityAnimatorRuntimeFile[];
        const uniquePaths = new Set(files.map((file) => file.path.toLocaleLowerCase("en-US")));

        if (uniquePaths.size !== files.length || !uniquePaths.has("runtime.json") || !uniquePaths.has("geometry.bin") || !uniquePaths.has("animations.bin"))
            return null;

        const totalSize = files.reduce((total, file) => total + file.size, 0);

        if (!Number.isSafeInteger(totalSize) || totalSize <= 0 || totalSize > this.MAXIMUM_RUNTIME_PACKAGE_SIZE)
            return null;

        return value as AnimatorRuntimeMetadata;
    }

    private isAnimatorRuntimeFile(value: unknown): value is UnityAnimatorRuntimeFile {
        return (
            TypeCheck.isRecord(value) &&
            this.isAnimatorRuntimeFilePath(value.path) &&
            TypeCheck.isValidInteger(value.size, true) &&
            value.size > 0 &&
            value.size <= 1024 * 1024 * 1024 &&
            TypeCheck.isValidString(value.sha256, 64) &&
            /^[0-9a-f]{64}$/i.test(value.sha256)
        );
    }

    private isAnimatorRuntimeFilePath(value: unknown): value is string {
        return (
            TypeCheck.isValidString(value, 160) &&
            (
                value === "runtime.json" ||
                value === "geometry.bin" ||
                value === "animations.bin" ||
                /^textures\/[0-9a-f]{64}\.png$/i.test(value)
            )
        );
    }

    private async validateRuntimeFiles(entryPath: string, files: readonly UnityAnimatorRuntimeFile[]) {
        let totalSize = 0;

        for (const file of files)
        {
            if (!this.isAnimatorRuntimeFile(file))
                throw new Error("The Animator runtime package contains an invalid file.");

            const filePath = this.getAnimatorRuntimeFilePath(entryPath, file.path);
            const stats = await fse.lstat(filePath);

            if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== file.size)
                throw new Error(`The Animator runtime file "${file.path}" is invalid.`);

            if (await this.hashFile(filePath) !== file.sha256)
                throw new Error(`The Animator runtime file "${file.path}" failed its integrity check.`);

            totalSize += stats.size;
        }

        if (!Number.isSafeInteger(totalSize) || totalSize > this.MAXIMUM_RUNTIME_PACKAGE_SIZE)
            throw new Error("The Animator runtime package has an invalid total size.");
    }

    private getAnimatorRuntimeFilePath(entryPath: string, relativePath: string): string {
        if (!this.isAnimatorRuntimeFilePath(relativePath))
            throw new Error("Invalid Animator runtime file path.");

        const filePath = path.join(entryPath, ...relativePath.split("/"));
        if (!Paths.isSubpath(entryPath, filePath))
            throw new Error("Invalid Animator runtime file path.");

        return filePath;
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

    private createAnimatorRuntimeKey(locator: string): string {
        return createHash("sha256")
            .update("AnimatorRuntime")
            .update("\0")
            .update(String(this.ANIMATOR_RUNTIME_FORMAT_VERSION))
            .update("\0")
            .update(StringUtils.normalize(locator))
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
