import { TypeCheck } from "#utils/TypeCheck.js";
import path from "node:path";
import fse from "fs-extra";

export type DirectoryStorageMeasurement = Readonly<{
    sizeBytes: number;
    fileCount: number;
}>;

export class DirectoryStorageService {
    async measure(rootPath: string): Promise<DirectoryStorageMeasurement> {
        const pendingDirectories = [rootPath];
        let sizeBytes = 0;
        let fileCount = 0;

        while (pendingDirectories.length > 0)
        {
            const directoryPath = pendingDirectories.pop()!;

            try
            {
                const directoryStats = await fse.lstat(directoryPath);
                if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
                    continue;

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
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                    continue;

                throw error;
            }
        }

        if (!TypeCheck.isValidInteger(sizeBytes, true) || !TypeCheck.isValidInteger(fileCount, true))
            throw new Error("The directory storage usage is too large to represent safely.");

        return Object.freeze({
            sizeBytes,
            fileCount
        });
    }
}

export const directoryStorageService = new DirectoryStorageService();
