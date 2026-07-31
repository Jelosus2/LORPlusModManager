import type { ModSyncLogEntry, ModSyncMethod, ModSyncProgress, ModSyncRequest, ModSyncResult, PersistedMod } from "../../shared/mod.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { ModSyncOperationJournal } from "./ModSyncOperationJournal.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type ModSyncInstallMethod = Exclude<ModSyncMethod, "unsync">;

type ProgressReporter = (progress: ModSyncProgress) => void;

export class ModSynchronizer {
    private readonly settingsRepository = new SettingsRepository();
    private readonly modRepository = new ModRepository();
    private readonly operationJournal = new ModSyncOperationJournal();

    async synchronize(request: ModSyncRequest, reportProgress: ProgressReporter): Promise<ModSyncResult> {
        const mods = this.modRepository.getAll();
        const knownModIds = new Set(mods.map((mod) => mod.id));

        for (const modId of request.enabledModIds)
        {
            if (!knownModIds.has(modId))
                throw new Error("The synchronization request contains an unknown mod.");
        }

        const desiredEnabledIds = request.method === "unsync"
            ? new Set<string>()
            : new Set(request.enabledModIds);

        const gameLocation = this.settingsRepository.getGameLocation();

        if (!gameLocation)
            throw new Error("The game location has not been configured.");
        if (!await fse.exists(gameLocation))
            throw new Error("The configured game location no longer exists.");

        const { targetRoot, workRoot } = await this.getSynchronizationRoots();

        const entries: ModSyncLogEntry[] = [];

        reportProgress({
            progress: 0,
            status: "Preparing synchronization",
            detail: `${mods.length} ${mods.length === 1 ? "mod" : "mods"} to process`,
            entry: null
        });

        for (let i = 0; i < mods.length; i++)
        {
            const mod = mods[i];
            const shouldBeEnabled = desiredEnabledIds.has(mod.id);

            reportProgress({
                progress: (i / Math.max(mods.length, 1)) * 100,
                status: `Processing ${i + 1} of ${mods.length}`,
                detail: mod.directoryName,
                entry: null
            });

            const entry = await this.processMod(mod, shouldBeEnabled, request.method, targetRoot, workRoot);

            entries.push(entry);

            reportProgress({
                progress: ((i + 1) / Math.max(mods.length, 1)) * 100,
                status: `Processed ${i + 1} of ${mods.length}`,
                detail: mod.directoryName,
                entry
            });
        }

        const failedCount = entries.filter((entry) => entry.status === "failed").length;

        return {
            success: failedCount === 0,
            message: failedCount === 0
                ? "Synchronization completed"
                : `Synchronization completed with ${failedCount} ${failedCount === 1 ? "failure" : "failures"}`,
            entries
        };
    }

    async getInstallationMethod(modId: string): Promise<ModSyncInstallMethod | null> {
        const mod = this.getMod(modId);
        if (!mod.enabled)
            return null;

        const { targetRoot } = await this.getSynchronizationRoots();
        const destination = path.join(targetRoot, mod.directoryName);

        if (!Paths.isSubpath(targetRoot, destination))
            throw new Error("The synchronized mod directory is invalid.");

        try
        {
            const stats = await fse.lstat(destination);

            if (stats.isSymbolicLink())
                return "symlink";
            if (stats.isDirectory())
                return "copy";

            throw new Error("The synchronized mod destination is not a directory.");
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return null;

            throw error;
        }
    }

    async detachMod(modId: string): Promise<ModSyncInstallMethod | null> {
        const mod = this.getMod(modId);
        if (!mod.enabled)
            return null;

        const { targetRoot, workRoot } = await this.getSynchronizationRoots();
        const method = await this.getInstallationMethod(modId);

        await this.removeMod(mod, targetRoot, workRoot);
        return method;
    }

    async attachMod(modId: string, method: ModSyncInstallMethod) {
        const mod = this.getMod(modId);
        if (mod.enabled)
            return;

        const { targetRoot, workRoot } = await this.getSynchronizationRoots();
        await this.installMod(mod, method, targetRoot, workRoot);
    }

    private async processMod(
        mod: PersistedMod,
        shouldBeEnabled: boolean,
        method: ModSyncMethod,
        targetRoot: string,
        workRoot: string
    ): Promise<ModSyncLogEntry> {
        if (shouldBeEnabled === mod.enabled)
        {
            if (shouldBeEnabled)
            {
                try
                {
                    await this.verifyExistingSynchronization(mod, targetRoot);
                }
                catch (error)
                {
                    return {
                        modId: mod.id,
                        directoryName: mod.directoryName,
                        status: "failed",
                        message: this.errorMessage(error)
                    };
                }
            }

            return {
                modId: mod.id,
                directoryName: mod.directoryName,
                status: "unchanged",
                message: shouldBeEnabled
                    ? "Already synchronized"
                    : "Already unsynchronized"
            };
        }

        try
        {
            if (shouldBeEnabled)
            {
                await this.installMod(mod, method, targetRoot, workRoot);

                return {
                    modId: mod.id,
                    directoryName: mod.directoryName,
                    status: "synced",
                    message: method === "symlink"
                        ? "Symbolic link created."
                        : "Copied into the game folder."
                };
            }

            await this.removeMod(mod, targetRoot, workRoot);

            return {
                modId: mod.id,
                directoryName: mod.directoryName,
                status: "unsynced",
                message: "Removed from the game folder."
            };
        }
        catch (error)
        {
            return {
                modId: mod.id,
                directoryName: mod.directoryName,
                status: "failed",
                message: this.errorMessage(error)
            };
        }
    }

    private async installMod(mod: PersistedMod, method: ModSyncMethod, targetRoot: string, workRoot: string) {
        if (method !== "copy" && method !== "symlink")
            throw new Error("An installation method was not provided.");
        if (!Paths.isSafeModDirectoryName(mod.directoryName))
            throw new Error("The mod directory name is invalid.");

        const modsRoot = Paths.getModsPath();
        const source = path.join(modsRoot, mod.directoryName);
        const destination = path.join(targetRoot, mod.directoryName);

        if (!Paths.isSubpath(modsRoot, source))
            throw new Error("The source mod directory is invalid.");
        if (!Paths.isSubpath(targetRoot, destination))
            throw new Error("The destination mod directory is invalid.");

        await this.verifySourceAssets(mod, source);

        if (await this.entryExists(destination))
            throw new Error(`A directory named "${mod.directoryName}" already exists in the game mod folder.`);

        const operation = await this.operationJournal.begin(mod.id, mod.directoryName, true, method);
        const operationRoot = path.join(workRoot, operation.id);
        const incoming = path.join(operationRoot, "incoming");

        let incomingInstalled = false;

        await fse.ensureDir(operationRoot);

        try
        {
            if (method === "copy")
                await fse.copy(source, incoming, { overwrite: false, errorOnExist: true });
            else
                await fse.symlink(source, incoming, "dir");

            await fse.rename(incoming, destination);
            incomingInstalled = true;

            if (!this.modRepository.setEnabled(mod.id, true))
                throw new Error("The mod library entry could not be updated.");
        }
        catch (error)
        {
            try
            {
                if (incomingInstalled && await this.entryExists(destination))
                    await fse.remove(destination);
            }
            catch (rollbackError)
            {
                throw new Error(`${this.errorMessage(error)} Rollback also failed: ${this.errorMessage(rollbackError)}`);
            }

            await this.finishOperation(operation.id, operationRoot);
            throw error;
        }

        await this.finishOperation(operation.id, operationRoot);
    }

    private async removeMod(mod: PersistedMod, targetRoot: string, workRoot: string) {
        if (!Paths.isSafeModDirectoryName(mod.directoryName))
            throw new Error("The mod directory name is invalid.");

        const destination = path.join(targetRoot, mod.directoryName);
        if (!Paths.isSubpath(targetRoot, destination))
            throw new Error("The destination mod directory is invalid.");

        const operation = await this.operationJournal.begin(mod.id, mod.directoryName, false, null);
        const operationRoot = path.join(workRoot, operation.id);
        const previous = path.join(operationRoot, "previous");

        if (!await this.entryExists(destination))
        {
            try
            {
                if (!this.modRepository.setEnabled(mod.id, false))
                    throw new Error("The mod library entry could not be updated.");
            }
            catch (error)
            {
                await this.finishOperation(operation.id, operationRoot);
                throw error;
            }

            await this.finishOperation(operation.id, operationRoot);
            return;
        }

        let destinationMoved = false;

        await fse.ensureDir(operationRoot);

        try
        {
            await fse.rename(destination, previous);
            destinationMoved = true;

            if (!this.modRepository.setEnabled(mod.id, false))
                throw new Error("The mod library entry could not be updated.");
        }
        catch (error)
        {
            try
            {
                if (destinationMoved && await this.entryExists(previous))
                    await fse.rename(previous, destination);
            }
            catch (rollbackError)
            {
                throw new Error(`${this.errorMessage(error)} Rollback also failed: ${this.errorMessage(rollbackError)}`);
            }

            await this.finishOperation(operation.id, operationRoot);
            throw error;
        }

        await this.finishOperation(operation.id, operationRoot);
    }

    private async verifySourceAssets(mod: PersistedMod, source: string) {
        await this.verifyModAssets(mod, source, "imported");
    }

    private async verifyModAssets(mod: PersistedMod, directory: string, location: "imported" | "synchronized") {
        const directoryDescription = location === "imported"
            ? "The imported mod directory"
            : "The synchronized mod directory";

        let directoryStats: fse.Stats;

        try
        {
            directoryStats = await fse.stat(directory);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                throw new Error(`${directoryDescription} is missing.`);

            throw error;
        }

        if (!directoryStats.isDirectory())
            throw new Error(`${directoryDescription} is not a directory.`);

        for (const assetName of mod.assetNames)
        {
            if (path.basename(assetName) !== assetName)
                throw new Error(`Invalid asset name: ${assetName}.`);

            const assetPath = path.join(directory, assetName);
            if (!Paths.isSubpath(directory, assetPath))
                throw new Error(`Invalid asset path: ${assetName}.`);

            try
            {
                const stats = await fse.stat(assetPath);

                if (!stats.isFile())
                    throw new Error(`Required ${location} mod asset is not a file: ${assetName}.`);
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                    throw new Error(`Required ${location} mod asset is missing: ${assetName}.`);

                throw error;
            }
        }
    }

    private async verifyExistingSynchronization(mod: PersistedMod, targetRoot: string) {
        if (!Paths.isSafeModDirectoryName(mod.directoryName))
            throw new Error("The mod directory name is invalid.");

        const modsRoot = Paths.getModsPath();
        const source = path.join(modsRoot, mod.directoryName);
        const destination = path.join(targetRoot, mod.directoryName);

        if (!Paths.isSubpath(modsRoot, source))
            throw new Error("The imported mod directory is invalid.");
        if (!Paths.isSubpath(targetRoot, destination))
            throw new Error("The synchronized mod directory is invalid.");

        await this.verifyModAssets(mod, source, "imported");
        await this.verifyModAssets(mod, destination, "synchronized");
    }

    private async prepareTargetRoot(gameLocation: string): Promise<string> {
        const pluginPath = path.join(Paths.getGamePluginRoot(gameLocation), "LOPlugin+.dll");
        if (!await fse.exists(pluginPath))
            throw new Error("The plugin LOPlugin+ is missing.");

        const targetRoot = Paths.getGameModsPath(gameLocation);

        if (!Paths.isSubpath(gameLocation, targetRoot))
            throw new Error("The synchronization directory is invalid.");

        await fse.ensureDir(targetRoot);
        return targetRoot;
    }

    private async entryExists(entryPath: string): Promise<boolean> {
        try
        {
            await fse.lstat(entryPath);
            return true;
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return false;

            throw error;
        }
    }

    private async finishOperation(operationId: string, operationRoot: string) {
        try
        {
            await fse.remove(operationRoot);
            await this.operationJournal.complete(operationId);
        }
        catch (error)
        {
            console.error(`Could not finish synchronization operation ${operationId}:`, error);
        }
    }

    private async getSynchronizationRoots() {
        const gameLocation = this.settingsRepository.getGameLocation();

        if (!gameLocation)
            throw new Error("The game location has not been configured.");
        if (!await fse.exists(gameLocation))
            throw new Error("The configured game location no longer exists.");

        return {
            targetRoot: await this.prepareTargetRoot(gameLocation),
            workRoot: Paths.getGameSyncWorkRoot(gameLocation)
        };
    }

    private getMod(modId: string): PersistedMod {
        const mod = this.modRepository.getAll().find((candidate) => candidate.id === modId);
        if (!mod)
            throw new Error("The selected mod could not be found.");

        return mod;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error
            ? error.message
            : "An unexpected synchronization error occurred.";
    }
}
