import type { BulkModDeletionResult, PersistedMod } from "../../shared/mod.js";

import { ModSynchronizer, type ModSyncInstallMethod } from "./ModSynchronizer.js";
import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { AdminPrivilegeService } from "#utils/AdminPrivilegeService.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { ModOperationJournal } from "./ModOperationJournal.js";
import { Paths } from "#utils/Paths.js";
import { shell } from "electron";
import path from "node:path";
import fse from "fs-extra";

type ModRenamePlan = Readonly<{
    previousName: string;
    directoryName: string;
    previousPath: string;
    destinationPath: string;
    caseOnlyRename: boolean;
}>;

type DirectoryOpenResult = Readonly<{
    opened: boolean;
    message: string;
}>;

export class ModLibraryError extends UserFacingError {
    constructor(message: string, options?: ErrorOptions) {
        super(ErrorUtils.combineWithCause(message, options?.cause), options);
        this.name = "ModLibraryError";
    }
}

export class ModLibraryService {
    private readonly settingsRepository = new SettingsRepository();
    private readonly modRepository = new ModRepository();
    private readonly operationJournal = new ModOperationJournal();
    private readonly modSynchronizer = new ModSynchronizer();

    async openFolder(modId: string) {
        const mod = this.getMod(modId);
        const failures: string[] = [];

        if (mod.enabled)
        {
            const gameLocation = this.settingsRepository.getGameLocation();

            if (!gameLocation)
            {
                failures.push("The synchronized directory could not be checked because the game location is not configured.");
            }
            else
            {
                const gameModsRoot = Paths.getGameModsPath(gameLocation);
                const synchronizedDirectory = path.join(gameModsRoot, mod.directoryName);

                if (!Paths.isSubpath(gameModsRoot, synchronizedDirectory))
                {
                    failures.push("The synchronized mod directory resolves outside the game mod directory.");
                }
                else
                {
                    const result = await this.tryOpenDirectory(synchronizedDirectory, "The synchronized mod directory");
                    if (result.opened)
                        return;

                    failures.push(result.message);
                }
            }
        }

        const importedDirectory = this.resolveModDirectory(mod.directoryName);
        const importedResult = await this.tryOpenDirectory(importedDirectory, "The imported mod directory");

        if (importedResult.opened)
            return;

        failures.push(importedResult.message);

        throw new ModLibraryError(`${mod.enabled ? "Neither mod directory could be opened." : "The mod directory could not be opened."} ${failures.join(" ")}`);
    }

    async delete(modId: string) {
        const synchronizationMethod = await this.modSynchronizer.detachMod(modId);

        try
        {
            await this.deleteUnsynchronized(modId);
        }
        catch (error)
        {
            if (synchronizationMethod)
            {
                try
                {
                    await this.modSynchronizer.attachMod(modId, synchronizationMethod);
                }
                catch (restoreError)
                {
                    throw new ModLibraryError(
                        "The mod could not be deleted, and its synchronized state could not be restored.",
                        { cause: new AggregateError([error, restoreError], "Deletion and synchronization restoration both failed.") }
                    );
                }
            }

            throw error;
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
                    message: ErrorUtils.getUserErrorMessage(error, "The mod could not be deleted.")
                });
            }
        }

        return {
            deletedModIds,
            failures
        };
    }

    async rename(modId: string, requestedDirectoryName: string) {
        const plan = await this.createRenamePlan(modId, requestedDirectoryName);
        if (!plan)
            return;

        const synchronizationMethod = await this.modSynchronizer.getInstallationMethod(modId);
        if (synchronizationMethod === "symlink" && !await AdminPrivilegeService.hasAdminPrivileges())
            throw new ModLibraryError("Administrator privileges are required to rename a mod synchronized with symbolic links.");

        const detachedMethod = await this.modSynchronizer.detachMod(modId);

        try
        {
            await this.renameUnsynchronized(modId, plan);
        }
        catch (error)
        {
            await this.restoreSynchronizationAfterFailure(modId, detachedMethod, error, "The mod could not be renamed.");
        }

        if (!detachedMethod)
            return;

        try
        {
            await this.modSynchronizer.attachMod(modId, detachedMethod);
        }
        catch (error)
        {
            try
            {
                const rollbackPlan = await this.createRenamePlan(modId, plan.previousName);
                if (!rollbackPlan)
                    throw new Error("The rename rollback could not be prepared.");

                await this.renameUnsynchronized(modId, rollbackPlan);
                await this.modSynchronizer.attachMod(modId, detachedMethod);
            }
            catch (rollbackError)
            {
                throw new ModLibraryError(
                    "The mod was renamed, but its synchronized state could not be restored. Refresh the mod list before trying again.",
                    { cause: new AggregateError([error, rollbackError], "Synchronization restoration and rename rollback both failed.") }
                );
            }

            throw new ModLibraryError(
                "The synchronized mod could not be renamed. Its previous name and synchronized state were restored.",
                { cause: error }
            );
        }
    }

    private async deleteUnsynchronized(modId: string) {
        const directoryName = this.getDirectoryName(modId);
        const directoryPath = this.resolveModDirectory(directoryName);

        const operation = await this.operationJournal.beginDelete(modId, directoryName);

        let directoryMoved = false;

        try
        {
            if (await fse.exists(directoryPath))
            {
                await fse.ensureDir(path.dirname(operation.trashDirectory));
                await fse.move(directoryPath, operation.trashDirectory);
                directoryMoved = true;
            }

            if (!this.modRepository.deleteById(modId))
                throw new ModLibraryError("The selected mod could not be found.");
        }
        catch (error)
        {
            let rollbackSucceeded = !directoryMoved;

            if (directoryMoved)
            {
                try
                {
                    await fse.move(operation.trashDirectory, directoryPath);
                    rollbackSucceeded = true;
                }
                catch (rollbackError)
                {
                    console.error("Could not restore the mod after deletion failed:", rollbackError);
                }
            }

            if (rollbackSucceeded)
                await this.completeOperationQuietly(operation.id);

            if (error instanceof ModLibraryError)
                throw error;

            throw new ModLibraryError("The mod could not be deleted.", { cause: error });
        }

        if (directoryMoved)
        {
            try
            {
                await fse.rm(operation.trashDirectory, { recursive: true, force: true });
            }
            catch (error)
            {
                console.error("Could not clean the deleted mod directory:", error);
                return;
            }
        }

        await this.completeOperationQuietly(operation.id);
    }

    private async renameUnsynchronized(modId: string, plan: ModRenamePlan) {
        const { previousName, directoryName, previousPath, destinationPath, caseOnlyRename } = plan;

        const operation = await this.operationJournal.beginRename(modId, previousName, directoryName, caseOnlyRename);
        let currentPath = previousPath;

        try
        {
            if (operation.temporaryDirectory)
            {
                await fse.move(previousPath, operation.temporaryDirectory);
                currentPath = operation.temporaryDirectory;

                await fse.move(operation.temporaryDirectory, destinationPath);
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
            let rollbackSucceeded = currentPath === previousPath;

            if (currentPath !== previousPath && await fse.exists(currentPath))
            {
                try
                {
                    await fse.move(currentPath, previousPath);
                    rollbackSucceeded = true;
                }
                catch (rollbackError)
                {
                    console.error("Could not restore the mod directory after renaming failed:", rollbackError);
                }
            }

            if (rollbackSucceeded)
                await this.completeOperationQuietly(operation.id);

            if (error instanceof ModLibraryError)
                throw error;

            throw new ModLibraryError("The mod could not be renamed.", { cause: error });
        }

        await this.completeOperationQuietly(operation.id);
    }

    private async createRenamePlan(modId: string, requestedDirectoryName: string): Promise<ModRenamePlan | null> {
        const previousName = this.getDirectoryName(modId);
        const directoryName = Paths.sanitizeDirectoryName(requestedDirectoryName, "mod", 80);

        if (previousName === directoryName)
            return null;
        if (this.modRepository.directoryNameExists(directoryName, modId))
            throw new ModLibraryError("Another mod already uses that name.");

        const previousPath = this.resolveModDirectory(previousName);
        const destinationPath = this.resolveModDirectory(directoryName);

        if (!await fse.exists(previousPath))
            throw new ModLibraryError("The mod directory no longer exists.");

        const caseOnlyRename = Paths.normalizeDirectoryName(previousName) === Paths.normalizeDirectoryName(directoryName);
        if (!caseOnlyRename && await fse.exists(destinationPath))
            throw new ModLibraryError("A directory with that name already exists.");

        return {
            previousName,
            directoryName,
            previousPath,
            destinationPath,
            caseOnlyRename
        };
    }

    private async restoreSynchronizationAfterFailure(
        modId: string,
        method: ModSyncInstallMethod | null,
        operationError: unknown,
        message: string
    ): Promise<never> {
        if (method)
        {
            try
            {
                await this.modSynchronizer.attachMod(modId, method);
            }
            catch (error)
            {
                throw new ModLibraryError(`${message} Its synchronized state could not be restored.`, {
                    cause: new AggregateError([operationError, error], "The operation and synchronization restoration both failed.")
                });
            }
        }

        if (operationError instanceof ModLibraryError)
            throw operationError;

        throw new ModLibraryError(message, { cause: operationError });
    }

    private async completeOperationQuietly(operationId: string) {
        try
        {
            await this.operationJournal.complete(operationId);
        }
        catch (error)
        {
            console.error(`Could not complete mod operation ${operationId}:`, error);
        }
    }

    private async tryOpenDirectory(directoryPath: string, description: string): Promise<DirectoryOpenResult> {
        try
        {
            const stats = await fse.stat(directoryPath);
            if (!stats.isDirectory())
            {
                return {
                    opened: false,
                    message: `${description} exists, but it is not a directory.`
                };
            }

            const shellError = await shell.openPath(directoryPath);
            if (shellError)
            {
                console.log(`Could not open directory ${directoryPath}: ${shellError}`);

                return {
                    opened: false,
                    message: `${description} exists, but Windows could not open it. ${shellError.trim()}`
                };
            }

            return {
                opened: true,
                message: ""
            };
        }
        catch (error)
        {
            console.log(`Could not access directory ${directoryPath}:`, error);

            return {
                opened: false,
                message: ErrorUtils.combineWithCause(`${description} could not be accessed.`, error, "An unexpected filesystem error occurred.")
            };
        }
    }

    private getMod(modId: string): PersistedMod {
        const mod = this.modRepository.getAll().find((candidate) => candidate.id === modId);
        if (!mod)
            throw new ModLibraryError("The selected mod could not be found.");

        return mod;
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
