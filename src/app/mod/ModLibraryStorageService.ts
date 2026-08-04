import type { ModLibraryStorageSummary } from "../../shared/mod.js";

import { ModRepository } from "#database/repositories/ModRepository.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type DirectoryMeasurement = Readonly<{
    sizeBytes: number;
    fileCount: number;
}>;

export class ModLibraryStorageService {
    private static readonly MAX_CONCURRENT_DIRECTORIES = 6;
    private readonly modRepository = new ModRepository();

    async getSummary(): Promise<ModLibraryStorageSummary> {
        const modsRoot = Paths.getModsPath();
        const directoryNames = this.modRepository.getDirectoryNames();
        const measurements = await this.measureDirectories(directoryNames);

        let sizeBytes = 0;
        let fileCount = 0;
        let availableModCount = 0;

        for (const measurement of measurements)
        {
            if (!measurement)
                continue;

            sizeBytes += measurement.sizeBytes;
            fileCount += measurement.fileCount;
            availableModCount++;
        }

        if (!TypeCheck.isValidInteger(sizeBytes, true) || !TypeCheck.isValidInteger(fileCount, true))
            throw new Error("The mod library storage usage is too large to represent safely.");

        return Object.freeze({
            path: modsRoot,
            sizeBytes,
            fileCount,
            modCount: directoryNames.length,
            availableModCount,
            unavailableModCount: directoryNames.length - availableModCount
        });
    }

    private async measureDirectories(directoryNames: readonly string[]): Promise<readonly (DirectoryMeasurement | null)[]> {
        const results = new Array<DirectoryMeasurement | null>(directoryNames.length);
        let nextIndex = 0;

        const worker = async () => {
            while (true)
            {
                const index = nextIndex++;
                if (index >= directoryNames.length)
                    return;

                results[index] = await this.tryMeasureModDirectory(directoryNames[index]);
            }
        };

        const workerCount = Math.min(ModLibraryStorageService.MAX_CONCURRENT_DIRECTORIES, directoryNames.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        return results;
    }

    private async tryMeasureModDirectory(directoryName: string): Promise<DirectoryMeasurement | null> {
        if (!Paths.isSafeModDirectoryName(directoryName))
        {
            console.log(`Could not measure mod directory with invalid name: ${directoryName}`);
            return null;
        }

        const modsRoot = Paths.getModsPath();
        const directoryPath = path.join(modsRoot, directoryName);

        if (!Paths.isSubpath(modsRoot, directoryPath))
            return null;

        try
        {
            const stats = await fse.lstat(directoryPath);
            if (!stats.isDirectory() || stats.isSymbolicLink())
                return null;

            return await this.measureDirectory(directoryPath);
        }
        catch (error)
        {
            if (!TypeCheck.isNodeError(error) || error.code !== "ENOENT")
                console.error(`Could not measure mod directory ${directoryPath}:`, error);

            return null;
        }
    }

    private async measureDirectory(rootPath: string): Promise<DirectoryMeasurement> {
        const pendingDirectories = [rootPath];
        let sizeBytes = 0;
        let fileCount = 0;

        while (pendingDirectories.length > 0)
        {
            const directoryPath = pendingDirectories.pop()!;
            const directory = await fse.opendir(directoryPath);

            for await (const entry of directory)
            {
                if (entry.isSymbolicLink())
                    continue;

                const entryPath = path.join(directoryPath, entry.name);
                if (entry.isDirectory())
                {
                    pendingDirectories.push(entryPath);
                    continue;
                }

                if (!entry.isFile())
                    continue;

                try
                {
                    const stats = await fse.lstat(entryPath);
                    if (!stats.isFile() || stats.isSymbolicLink())
                        continue;

                    sizeBytes += stats.size;
                    fileCount++;
                }
                catch (error)
                {
                    if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                        continue;

                    throw error;
                }
            }
        }

        return {
            sizeBytes,
            fileCount
        };
    }
}

export const modLibraryStorageService = new ModLibraryStorageService();
