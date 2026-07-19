import type { CentralDirectory, File as ZipFile } from "unzipper";

import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { Open } from "unzipper";
import path from "node:path";
import fse from "fs-extra";

export type ZipEntryInfo = {
    path: string;
    type: "File" | "Directory";
    compressedSize: number;
    uncompressedSize: number;
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

    async readFile(archivePath: string, entryPath: string, maxBytes = 4 * 1024 ** 2): Promise<Buffer> {
        const archive = await Open.file(archivePath);
        const normalizedPath = this.normalizeEntryPath(entryPath);

        const entry = archive.files.find((candidate) =>
            candidate.type === "File" && this.normalizeEntryPath(candidate.path) === normalizedPath
        );

        if (!entry)
            throw new Error(`${normalizedPath} is missing from the archive.`);
        if (entry.uncompressedSize > maxBytes)
            throw new Error(`${normalizedPath} is too large to read into memory.`);

        const chunks: Buffer[] = [];
        const stream = entry.stream();

        let totalBytes = 0;

        try
        {
            for await (const value of stream)
            {
                const chunk = Buffer.from(value);

                totalBytes += chunk.length;
                if (totalBytes > maxBytes)
                    throw new Error(`${normalizedPath} exceeded the read limit.`);

                chunks.push(chunk);
            }
        }
        finally
        {
            stream.destroy();
        }

        if (totalBytes !== entry.uncompressedSize)
            throw new Error(`${normalizedPath} had an unexpected extracted size.`);

        return Buffer.concat(chunks);
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
        const entries = archives.flatMap((archive) => archive.files);
        const effectiveLimits = { ...this.DEFAULT_LIMITS, ...limits };

        this.validateEntries(entries, effectiveLimits);

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

        const extractedPaths = new Map<string, ZipFile["type"]>();
        let completedEntries = 0;
        let totalExtractedBytes = 0;

        try
        {
            for (const archive of archives)
            {
                await this.extractArchive(
                    archive,
                    destinationRoot,
                    effectiveLimits,
                    extractedPaths,
                    (entry, extractedBytes) => {
                        totalExtractedBytes += extractedBytes;
                        if (totalExtractedBytes > effectiveLimits.maxTotalUncompressedBytes)
                            throw new Error("The extracted data exceeded the configured size limit.");

                        completedEntries++;

                        reportProgress?.({
                            completedEntries,
                            totalEntries: entries.length,
                            currentEntry: entry.path
                        });
                    }
                );
            }
        }
        catch (error)
        {
            await fse.rm(destinationRoot, { recursive: true, force: true });
            throw error;
        }
    }

    private async extractArchive(
        archive: CentralDirectory,
        destinationRoot: string,
        limits: ZipExtractionLimits,
        extractedPaths: Map<string, ZipFile["type"]>,
        onEntryComplete: (entry: ZipFile, extractedBytes: number) => void
    ) {
        for (const entry of archive.files)
        {
            const normalizedPath = this.normalizeEntryPath(entry.path);
            const collisionKey = normalizedPath.toLowerCase();
            const existingType = extractedPaths.get(collisionKey);

            if (existingType)
            {
                if (existingType === "Directory" && entry.type === "Directory")
                {
                    onEntryComplete(entry, 0);
                    continue;
                }

                throw new Error(`Multiple archive entries target ${normalizedPath}.`);
            }

            extractedPaths.set(collisionKey, entry.type);

            const targetPath = this.resolveTargetPath(destinationRoot, normalizedPath);
            if (entry.type === "Directory")
            {
                await fse.ensureDir(targetPath);
                onEntryComplete(entry, 0);
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
                    if (extractedBytes > limits.maxEntryUncompressedBytes)
                    {
                        callback(new Error(`${normalizedPath} exceeded the per-file size limit.`));
                        return;
                    }

                    callback(null, chunk);
                }
            });

            await pipeline(
                entry.stream(),
                sizeGuard,
                fse.createWriteStream(targetPath, { flags: "wx" })
            );

            if (extractedBytes !== entry.uncompressedSize)
                throw new Error(`${normalizedPath} had an unexpected extracted size.`);

            onEntryComplete(entry, extractedBytes);
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
