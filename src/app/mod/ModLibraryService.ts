import type { BulkModDeletionResult } from "../../shared/mod.js";

import { ModRepository } from "#database/repositories/ModRepository.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import { shell } from "electron";
import path from "node:path";
import fse from "fs-extra";

export class ModLibraryError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ModLibraryError";
    }
}

export class ModLibraryService {
    private readonly modRepository = new ModRepository();

    async openFolder(modId: string) {
        const directoryName = this.getDirectoryName(modId);
        const directoryPath = this.resolveModDirectory(directoryName);

        if (!await fse.exists(directoryPath))
            throw new ModLibraryError("The mod directory no longer exists.");

        const errorMessage = await shell.openPath(directoryPath);
        if (errorMessage)
            throw new ModLibraryError("The mod directory could not be opened.");
    }

    async delete(modId: string) {
        const directoryName = this.getDirectoryName(modId);
        const directoryPath = this.resolveModDirectory(directoryName);

        const modsRoot = Paths.getModsPath();
        const trashRoot = path.join(modsRoot, ".trash");
        const trashDirectory = path.join(trashRoot, randomUUID());

        let directoryMoved = false;

        try
        {
            if (await fse.exists(directoryPath))
            {
                await fse.ensureDir(trashRoot);
                await fse.move(directoryPath, trashDirectory);
                directoryMoved = true;
            }

            if (!this.modRepository.deleteById(modId))
                throw new ModLibraryError("The selected mod could not be found.");
        }
        catch (error)
        {
            if (directoryMoved)
            {
                try
                {
                    await fse.move(trashDirectory, directoryPath);
                }
                catch (rollbackError)
                {
                    console.error("Could not restore the mod after deletion failed:", rollbackError);
                }
            }

            if (error instanceof ModLibraryError)
                throw error;

            throw new ModLibraryError("The mod could not be deleted.", { cause: error });
        }

        if (!directoryMoved)
            return;

        try
        {
            await fse.rm(trashDirectory, { recursive: true, force: true });
        }
        catch (error)
        {
            console.error("Could not clean the deleted mod directory:", error);
        }
    }

    async deleteMany(modIds: readonly string[]): Promise<BulkModDeletionResult> {
        const deletedModIds: string[] = [];
        const failures: BulkModDeletionResult["failures"][number][] = [];

        for (const modId of modIds)
        {
            try
            {
                await this.delete(modId);
                deletedModIds.push(modId);
            }
            catch (error)
            {
                console.error(`Could not delete mod ${modId}:`, error);

                failures.push({
                    modId,
                    message: error instanceof ModLibraryError
                        ? error.message
                        : "The mod could not be deleted."
                });
            }
        }

        return {
            deletedModIds,
            failures
        };
    }

    async rename(modId: string, requestedDirectoryName: string) {
        const previousName = this.getDirectoryName(modId);
        const directoryName = Paths.sanitizeDirectoryName(requestedDirectoryName, "mod", 80);

        if (previousName === directoryName)
            return;
        if (this.modRepository.directoryNameExists(directoryName, modId))
            throw new ModLibraryError("Another mod already uses that name.");

        const previousPath = this.resolveModDirectory(previousName);
        const destinationPath = this.resolveModDirectory(directoryName);

        if (!await fse.exists(previousPath))
            throw new ModLibraryError("The mod directory no longer exists.");

        const caseOnlyRename = previousName.toLocaleLowerCase("en-US") === directoryName.toLocaleLowerCase("en-US");
        if (!caseOnlyRename && await fse.exists(destinationPath))
            throw new ModLibraryError("A directory with that name already exists.");

        let currentPath = previousPath;

        try
        {
            if (caseOnlyRename)
            {
                const tempPath = this.resolveModDirectory(`.rename-${randomUUID()}`);

                await fse.move(previousPath, tempPath);
                currentPath = tempPath;

                await fse.move(tempPath, destinationPath);
                currentPath = destinationPath;
            }
            else
            {
                await fse.move(previousPath, destinationPath);
                currentPath = destinationPath;
            }

            if (!this.modRepository.setDirectoryName(modId, directoryName))
                throw new ModLibraryError("The selected mod could not be found.");
        }
        catch (error)
        {
            if (currentPath !== previousPath && await fse.exists(currentPath))
            {
                try
                {
                    await fse.move(currentPath, previousPath);
                }
                catch (rollbackError)
                {
                    console.error("Could not restore the mod directory after renaming failed:", rollbackError);
                }
            }

            if (error instanceof ModLibraryError)
                throw error;

            throw new ModLibraryError("The mod could not be renamed.", { cause: error });
        }
    }

    private getDirectoryName(modId: string): string {
        const directoryName = this.modRepository.getDirectoryName(modId);
        if (!directoryName)
            throw new ModLibraryError("The selected mod could not be found.");

        return directoryName;
    }

    private resolveModDirectory(directoryName: string): string {
        const modsRoot = Paths.getModsPath();
        const modDirectory = path.join(modsRoot, directoryName);

        if (!Paths.isSubpath(modsRoot, modDirectory))
            throw new ModLibraryError("The mod directory is invalid.");

        return modDirectory;
    }
}
