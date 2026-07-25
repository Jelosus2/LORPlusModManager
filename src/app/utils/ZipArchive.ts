import type { File as ZipFile } from "unzipper";

import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Open } from "unzipper";
import fsp from "node:fs/promises";
import path from "node:path";
import fse from "fs-extra";

export type ZipEntryInfo = {
    path: string;
    type: "File" | "Directory";
    compressedSize: number;
    uncompressedSize: number;
};

export type ZipEntrySelection = {
    entryPath: string;
    outputName: string;
};

export type ZipExtractionLimits = {
    maxEntries: number;
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
};

export type ZipExtractionProgress = {
    completedEntries: number;
    totalEntries: number;
    currentEntry: string;
};

export type ExtractedZipEntry = {
    entryPath: string;
    filePath: string;
    uncompressedSize: number;
};

type PlannedZipEntry = {
    entry: ZipFile;
    outputPath: string;
    password?: string;
};

type ExtractedEntryContext = {
    entry: ZipFile;
    entryPath: string;
    outputPath: string;
    targetPath: string;
    extractedBytes: number;
};

type ExtractionHooks<TResult> = {
    afterFile?: (context: ExtractedEntryContext) =>
        | TResult
        | undefined
        | Promise<TResult | undefined>;

    onEntryComplete?: (context: ExtractedEntryContext) => void | Promise<void>;
};

export class ZipArchive {
    private readonly DEFAULT_LIMITS: ZipExtractionLimits = {
        maxEntries: 20_000,
        maxEntryUncompressedBytes: 1024 ** 3,
        maxTotalUncompressedBytes: 2 * 1024 ** 3
    };

    async inspect(archivePath: string, limits: Partial<ZipExtractionLimits> = {}): Promise<ZipEntryInfo[]> {
        const archive = await Open.file(archivePath);
        const effectiveLimits = { ...this.DEFAULT_LIMITS, ...limits };

        this.validateEntries(archive.files, effectiveLimits);

        return archive.files.map((entry) => ({
            path: this.normalizeEntryPath(entry.path),
            type: entry.type,
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize
        }));
    }

    async extractArchives(
        archivePaths: string[],
        destinationDirectory: string,
        limits: Partial<ZipExtractionLimits> = {},
        reportProgress?: (progress: ZipExtractionProgress) => void
    ) {
        if (archivePaths.length === 0)
            throw new Error("No ZIP archives were provided.");

        const archives = await Promise.all(archivePaths.map((archivePath) => Open.file(archivePath)));
        const plans: PlannedZipEntry[] = archives.flatMap((archive) =>
            archive.files.map((entry) => ({
                entry,
                outputPath: entry.path
            }))
        );

        let completedEntries = 0;

        await this.extractPlannedEntries(
            destinationDirectory,
            plans,
            limits,
            {
                onEntryComplete: ({ entryPath }) => {
                    completedEntries++;

                    reportProgress?.({
                        completedEntries,
                        totalEntries: plans.length,
                        currentEntry: entryPath
                    });
                }
            }
        );
    }

    async extractSelectedEntries(
        archivePath: string,
        destinationDirectory: string,
        selections: readonly ZipEntrySelection[],
        password?: string,
        limits: Partial<ZipExtractionLimits> = {}
    ) {
        if (selections.length === 0)
            throw new Error("No ZIP entries were selected.");

        const archive = await Open.file(archivePath);
        const entriesByPath = new Map<string, ZipFile>();

        for (const entry of archive.files)
        {
            if (entry.type !== "File")
                continue;

            const normalizedPath = this.normalizeEntryPath(entry.path);
            const key = normalizedPath.toLowerCase();

            if (entriesByPath.has(key))
                throw new Error(`The archive contains duplicate entries for ${normalizedPath}.`);

            entriesByPath.set(key, entry);
        }

        const plans: PlannedZipEntry[] = [];

        for (const selection of selections)
        {
            const normalizedEntryPath = this.normalizeEntryPath(selection.entryPath);
            const normalizedOutputName = this.normalizeEntryPath(selection.outputName);

            if (normalizedOutputName.includes("/"))
                throw new Error("Extracted asset names cannot contain directories.");

            const entry = entriesByPath.get(normalizedEntryPath.toLowerCase());
            if (!entry)
                throw new Error(`${normalizedEntryPath} is missing from the archive.`);

            plans.push({
                entry,
                outputPath: normalizedOutputName,
                password
            });
        }

        await this.extractPlannedEntries(destinationDirectory, plans, limits);
    }

    async extractEntriesMatchingSignature(
        archivePath: string,
        destinationDirectory: string,
        signature: Buffer,
        password?: string,
        limits: Partial<ZipExtractionLimits> = {}
    ): Promise<ExtractedZipEntry[]> {
        if (signature.length === 0 || signature.length > 64)
            throw new Error("Invalid file signature.");

        const archive = await Open.file(archivePath);
        const effectiveLimits = { ...this.DEFAULT_LIMITS, ...limits };

        this.validateEntries(archive.files, effectiveLimits);

        const entryPaths = new Set<string>();
        const plans: PlannedZipEntry[] = [];

        for (const entry of archive.files)
        {
            if (entry.type !== "File")
                continue;

            const normalizedPath = this.normalizeEntryPath(entry.path);
            const entryKey = normalizedPath.toLowerCase();

            if (entryPaths.has(entryKey))
                throw new Error(`The archive contains duplicate entries for ${normalizedPath}.`);

            entryPaths.add(entryKey);

            if (entry.uncompressedSize < signature.length)
                continue;

            plans.push({
                entry,
                outputPath: `.candidate-${plans.length}`,
                password
            });
        }

        if (plans.length === 0)
            return [];

        let matchedEntries = 0;

        return this.extractPlannedEntries(
            destinationDirectory,
            plans,
            effectiveLimits,
            {
                afterFile: async ({ entry, entryPath, targetPath }): Promise<ExtractedZipEntry | undefined> => {
                    const header = Buffer.alloc(signature.length);
                    let matchesSignature = false;

                    {
                        await using candidateFile = await fsp.open(targetPath, "r");
                        const { bytesRead } = await candidateFile.read(header, 0, header.length, 0);

                        matchesSignature = bytesRead === signature.length && header.equals(signature);
                    }

                    if (!matchesSignature)
                    {
                        await fse.unlink(targetPath);
                        return undefined;
                    }

                    const bundlePath = path.join(path.dirname(targetPath), `embedded-${matchedEntries}.bundle`);

                    matchedEntries++;
                    await fse.rename(targetPath, bundlePath);

                    return {
                        entryPath,
                        filePath: bundlePath,
                        uncompressedSize: entry.uncompressedSize
                    };
                }
            }
        );
    }

    private async extractPlannedEntries<TResult = never>(
        destinationDirectory: string,
        plans: readonly PlannedZipEntry[],
        limits: Partial<ZipExtractionLimits> = {},
        hooks: ExtractionHooks<TResult> = {}
    ): Promise<TResult[]> {
        const effectiveLimits = { ...this.DEFAULT_LIMITS, ...limits };

        this.validateEntries(plans.map(({ entry }) => entry), effectiveLimits);

        const normalizedPlans = plans.map((plan) => ({
            ...plan,
            entryPath: this.normalizeEntryPath(plan.entry.path),
            outputPath: this.normalizeEntryPath(plan.outputPath)
        }));

        const targetTypes = new Map<string, ZipFile["type"]>();

        for (const plan of normalizedPlans)
        {
            const collisionKey = plan.outputPath.toLowerCase();
            const existingType = targetTypes.get(collisionKey);

            if (existingType)
            {
                const duplicateDirectories = existingType === "Directory" && plan.entry.type === "Directory";
                if (!duplicateDirectories)
                    throw new Error(`Multiple archive entries target ${plan.outputPath}.`);

                continue;
            }

            targetTypes.set(collisionKey, plan.entry.type);
        }

        const destinationRoot = path.resolve(destinationDirectory);
        await fse.ensureDir(path.dirname(destinationRoot));

        try
        {
            await fse.mkdir(destinationRoot);
        }
        catch (error)
        {
            throw new Error(`The extraction directory already exists: ${destinationRoot}`, { cause: error });
        }

        const results: TResult[] = [];
        let totalExtractedBytes = 0;

        try
        {
            for (const plan of normalizedPlans)
            {
                const targetPath = this.resolveTargetPath(destinationRoot, plan.outputPath);

                if (plan.entry.type === "Directory")
                {
                    await fse.ensureDir(targetPath);

                    await hooks.onEntryComplete?.({
                        entry: plan.entry,
                        entryPath: plan.entryPath,
                        outputPath: plan.outputPath,
                        targetPath,
                        extractedBytes: 0
                    });

                    continue;
                }

                await fse.ensureDir(path.dirname(targetPath));

                let extractedBytes = 0;

                const sizeGuard = new Transform({
                    transform(chunk, _encoding, callback) {
                        const chunkSize = Buffer.isBuffer(chunk)
                            ? chunk.length
                            : Buffer.byteLength(chunk);

                        extractedBytes += chunkSize;
                        totalExtractedBytes += chunkSize;

                        if (extractedBytes > effectiveLimits.maxEntryUncompressedBytes)
                        {
                            callback(new Error(`${plan.outputPath} exceeded the per-file limit.`));
                            return;
                        }

                        if (totalExtractedBytes > effectiveLimits.maxTotalUncompressedBytes)
                        {
                            callback(new Error("The extracted data exceeded the total limit."));
                            return;
                        }

                        callback(null, chunk);
                    }
                });

                await pipeline(
                    plan.entry.stream(plan.password || undefined),
                    sizeGuard,
                    fse.createWriteStream(targetPath, { flags: "wx" })
                );

                if (extractedBytes !== plan.entry.uncompressedSize)
                    throw new Error(`${plan.outputPath} had an unexpected extracted size.`);

                const context: ExtractedEntryContext = {
                    entry: plan.entry,
                    entryPath: plan.entryPath,
                    outputPath: plan.outputPath,
                    targetPath,
                    extractedBytes
                };

                const result = await hooks.afterFile?.(context);
                if (result !== undefined)
                    results.push(result);

                await hooks.onEntryComplete?.(context);
            }

            return results;
        }
        catch (error)
        {
            await fse.rm(destinationRoot, { recursive: true, force: true });
            throw error;
        }
    }

    private validateEntries(entries: ZipFile[], limits: ZipExtractionLimits) {
        if (entries.length > limits.maxEntries)
            throw new Error("The archive contains too many entries.");

        let totalBytes = 0;

        for (const entry of entries)
        {
            this.normalizeEntryPath(entry.path);

            if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0)
                throw new Error(`${entry.path} has an invalid size.`);
            if (entry.uncompressedSize > limits.maxEntryUncompressedBytes)
                throw new Error(`${entry.path} is too large to extract.`);
            if (this.isUnixSymbolicLink(entry))
                throw new Error(`${entry.path} is a symbolic link.`);

            totalBytes += entry.uncompressedSize;
            if (totalBytes > limits.maxTotalUncompressedBytes)
                throw new Error("The archive expands beyond the size limit.");
        }
    }

    private normalizeEntryPath(entryPath: string) {
        const normalized = entryPath.replaceAll("\\", "/");
        if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized))
            throw new Error(`Unsafe archive path: ${entryPath}`);

        const parts = normalized.split("/").filter((part) => part.length > 0);
        if (parts.length === 0)
            throw new Error(`Unsafe archive path: ${entryPath}`);

        for (const part of parts) {
            if (part === "." || part === "..")
                throw new Error(`Unsafe archive path: ${entryPath}`);

            if (
                /[<>:"|?*\u0000-\u001f]/.test(part) ||
                /[. ]$/.test(part) ||
                /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)
            )
            {
                throw new Error(`Invalid Windows filename: ${entryPath}`);
            }
        }

        return parts.join("/");
    }

    private resolveTargetPath(root: string, entryPath: string) {
        const target = path.resolve(root, ...entryPath.split("/"));
        const relative = path.relative(root, target);

        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
            throw new Error(`Archive entry escapes its destination: ${entryPath}`);

        return target;
    }

    private isUnixSymbolicLink(entry: ZipFile) {
        const platform = entry.versionMadeBy >> 8;
        if (platform !== 3)
            return false;

        const unixMode = entry.externalFileAttributes >>> 16;
        return (unixMode & 0o170000) === 0o120000;
    }
}
