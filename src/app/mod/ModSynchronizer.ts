import type { ModSyncLogEntry, ModSyncMethod, ModSyncProgress, ModSyncRequest, ModSyncResult, PersistedMod } from "../../shared/mod.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type ProgressReporter = (progress: ModSyncProgress) => void;

export class ModSynchronizer {
    private readonly settingsRepository = new SettingsRepository();
    private readonly modRepository = new ModRepository();

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

        const targetRoot = await this.prepareTargetRoot();
        const workRoot = path.join(path.dirname(targetRoot), ".lorplus-sync");

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

    private async processMod(
        mod: PersistedMod,
        shouldBeEnabled: boolean,
        method: ModSyncMethod,
        targetRoot: string,
        workRoot: string
    ): Promise<ModSyncLogEntry> {
        if (shouldBeEnabled === mod.enabled)
        {
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

        const operationRoot = path.join(workRoot, randomUUID());
        const incoming = path.join(operationRoot, "incoming");

        let incomingInstalled = false;
        let preserveRecoveryFiles = false;

        await fse.ensureDir(operationRoot);

        try
        {
            if (method === "copy")
                await fse.copy(source, incoming, { errorOnExist: true });
            else
                await fse.symlink(source, incoming, "dir");

            if (await this.entryExists(destination))
            {
                throw new Error(`A directory named "${mod.directoryName}" already exists in the game mod folder.`);
            }

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
                preserveRecoveryFiles = true;
                throw new Error(`${this.errorMessage(error)} Rollback also failed: ${this.errorMessage(rollbackError)}`);
            }

            throw error;
        }
        finally
        {
            if (!preserveRecoveryFiles)
                await fse.remove(operationRoot).catch(() => undefined);
        }
    }

    private async removeMod(mod: PersistedMod, targetRoot: string, workRoot: string) {
        if (!Paths.isSafeModDirectoryName(mod.directoryName))
            throw new Error("The mod directory name is invalid.");

        const destination = path.join(targetRoot, mod.directoryName);
        if (!Paths.isSubpath(targetRoot, destination))
            throw new Error("The destination mod directory is invalid.");

        if (!await this.entryExists(destination))
        {
            if (!this.modRepository.setEnabled(mod.id, false))
                throw new Error("The mod library entry could not be updated.");

            return;
        }

        const operationRoot = path.join(workRoot, randomUUID());
        const previous = path.join(operationRoot, "previous");

        let destinationMoved = false;
        let preserveRecoveryFiles = false;

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
                preserveRecoveryFiles = true;
                throw new Error(`${this.errorMessage(error)} Rollback also failed: ${this.errorMessage(rollbackError)}`);
            }

            throw error;
        }
        finally
        {
            if (!preserveRecoveryFiles)
                await fse.remove(operationRoot).catch(() => undefined);
        }
    }

    private async verifySourceAssets(mod: PersistedMod, source: string) {
        const sourceStats = await fse.stat(source);
        if (!sourceStats.isDirectory())
            throw new Error("The imported mod directory is missing.");

        for (const assetName of mod.assetNames)
        {
            if (path.basename(assetName) !== assetName)
                throw new Error(`Invalid asset name: ${assetName}.`);

            const assetPath = path.join(source, assetName);
            if (!Paths.isSubpath(source, assetPath))
                throw new Error(`Invalid asset path: ${assetName}.`);

            try
            {
                const stats = await fse.stat(assetPath);
                if (!stats.isFile())
                    throw new Error();
            }
            catch
            {
                throw new Error(`Required asset is missing: ${assetName}.`);
            }
        }
    }

    private async prepareTargetRoot(): Promise<string> {
        const gameLocation = this.settingsRepository.getGameLocation();

        if (!gameLocation)
            throw new Error("The game location has not been configured.");
        if (!await fse.exists(gameLocation))
            throw new Error("The configured game location no longer exists.");

        const pluginPath = path.join(gameLocation, "BepInEx", "plugins", "LOPlugin+", "LOPlugin+.dll");
        if (!await fse.exists(pluginPath))
            throw new Error("The plugin is missing");

        const targetRoot = path.join(path.dirname(pluginPath), "mods");

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

    private errorMessage(error: unknown): string {
        return error instanceof Error
            ? error.message
            : "An unexpected synchronization error occurred.";
    }
}
