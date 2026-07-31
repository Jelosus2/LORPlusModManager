import type { ModSyncMethod } from "../../shared/mod.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type SyncInstallMethod = Exclude<ModSyncMethod, "unsync">;

type SyncOperationManifest = {
    version: 1;
    kind: "sync";
    id: string;
    modId: string;
    directoryName: string;
    desiredEnabled: boolean;
    method: SyncInstallMethod | null;
};

export type SyncOperation = Readonly<{
    id: string;
}>;

export class ModSyncOperationJournal {
    private readonly settingsRepository = new SettingsRepository();
    private readonly modRepository = new ModRepository();

    async begin(modId: string, directoryName: string, desiredEnabled: boolean, method: SyncInstallMethod | null): Promise<SyncOperation> {
        if (!TypeCheck.isUuid(modId))
            throw new Error("The synchronized mod ID is invalid.");
        if (!Paths.isSafeModDirectoryName(directoryName))
            throw new Error("The synchronized mod directory is invalid.");
        if (desiredEnabled && method !== "copy" && method !== "symlink")
            throw new Error("The synchronization method is invalid.");
        if (!desiredEnabled && method !== null)
            throw new Error("An unsynchronization operation cannot have an installation method.");

        const id = randomUUID();

        await this.writeManifest({
            version: 1,
            kind: "sync",
            id,
            modId,
            directoryName,
            desiredEnabled,
            method
        });

        return { id };
    }

    async complete(id: string) {
        if (!TypeCheck.isUuid(id))
            throw new Error("The synchronization operation ID is invalid.");

        const manifestPath = Paths.getSyncOperationManifestPath(id);

        await fse.rm(manifestPath, { force: true });
        await fse.rm(`${manifestPath}.tmp`, { force: true });
    }

    async recover() {
        const operationsRoot = Paths.getSyncOperationsRoot();
        await fse.ensureDir(operationsRoot);

        const files = await fse.readdir(operationsRoot);
        let failureCount = 0;

        for (const fileName of files)
        {
            if (fileName.endsWith(".tmp"))
            {
                await fse.rm(path.join(operationsRoot, fileName), { force: true });
                continue;
            }

            if (!fileName.endsWith(".json"))
                continue;

            const manifestPath = path.join(operationsRoot, fileName);

            try
            {
                const value: unknown = await fse.readJson(manifestPath, { encoding: "utf-8" });

                const expectedId = path.basename(fileName, ".json");
                const manifest = this.parseManifest(value, expectedId);

                if (!manifest)
                    throw new Error("The synchronization manifest is invalid.");

                await this.recoverManifest(manifest);
            }
            catch (error)
            {
                failureCount++;
                console.error(`Could not recover synchronization operation ${fileName}:`, error);
            }
        }

        if (failureCount > 0)
            throw new Error(`${failureCount} interrupted synchronization ${failureCount === 1 ? "operation could" : "operations could"} not be recovered.`);
    }

    private async recoverManifest(manifest: SyncOperationManifest) {
        const mod = this.modRepository.getAll().find((candidate) => candidate.id === manifest.modId);

        if (!mod)
            throw new Error("The synchronized mod is no longer registered.");
        if (Paths.normalizeDirectoryName(mod.directoryName) !== Paths.normalizeDirectoryName(manifest.directoryName))
            throw new Error("The synchronized mod now uses a different directory.");

        const gameLocation = this.settingsRepository.getGameLocation();

        if (!gameLocation || !await fse.pathExists(gameLocation))
            throw new Error("The configured game location is unavailable.");

        const targetRoot = Paths.getGameModsPath(gameLocation);
        const workRoot = Paths.getGameSyncWorkRoot(gameLocation);
        const operationRoot = path.join(workRoot, manifest.id);
        const destination = path.join(targetRoot, manifest.directoryName);
        const previous = path.join(operationRoot, "previous");

        if (!Paths.isSubpath(targetRoot, destination))
            throw new Error("The synchronized destination is invalid.");
        if (!Paths.isSubpath(workRoot, operationRoot))
            throw new Error("The synchronization work directory is invalid.");

        if (manifest.desiredEnabled)
            await this.recoverInstallation(mod.enabled, destination);
        else
            await this.recoverRemoval(mod.enabled, destination, previous, targetRoot);

        await fse.remove(operationRoot);
        await this.complete(manifest.id);
    }

    private async recoverInstallation(databaseEnabled: boolean, destination: string) {
        const destinationExists = await this.entryExists(destination);

        if (databaseEnabled)
        {
            if (!destinationExists)
                throw new Error("The database says the mod is synchronized, but its game directory is missing.");

            return;
        }

        if (destinationExists)
            await fse.remove(destination);
    }

    private async recoverRemoval(databaseEnabled: boolean, destination: string, previous: string, targetRoot: string) {
        const destinationExists = await this.entryExists(destination);
        const previousExists = await this.entryExists(previous);

        if (!databaseEnabled)
        {
            if (destinationExists)
            {
                throw new Error("An unsynchronized mod still exists in the game folder.");
            }

            return;
        }

        if (destinationExists && previousExists)
            throw new Error("Both the synchronized directory and its recovery backup exist.");

        if (destinationExists)
            return;

        if (!previousExists)
            throw new Error("The synchronized directory and its recovery backup are both missing.");

        await fse.ensureDir(targetRoot);
        await fse.rename(previous, destination);
    }

    private async writeManifest(manifest: SyncOperationManifest) {
        const operationsRoot = Paths.getSyncOperationsRoot();
        await fse.ensureDir(operationsRoot);

        const manifestPath = Paths.getSyncOperationManifestPath(manifest.id);
        const temporaryPath = `${manifestPath}.tmp`;

        await fse.writeJson(temporaryPath, manifest, { spaces: 2, encoding: "utf-8" });
        await fse.move(temporaryPath, manifestPath);
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

    private parseManifest(value: unknown, expectedId: string): SyncOperationManifest | null {
        if (!TypeCheck.isRecord(value))
            return null;

        if (
            value.version !== 1 ||
            value.kind !== "sync" ||
            !TypeCheck.isUuid(value.id) ||
            value.id !== expectedId ||
            !TypeCheck.isUuid(value.modId) ||
            !Paths.isSafeModDirectoryName(value.directoryName) ||
            !TypeCheck.isBoolean(value.desiredEnabled)
        )
        {
            return null;
        }

        if (value.desiredEnabled && value.method !== "copy" && value.method !== "symlink")
            return null;
        if (!value.desiredEnabled && value.method !== null)
            return null;

        return {
            version: 1,
            kind: "sync",
            id: value.id,
            modId: value.modId,
            directoryName: value.directoryName,
            desiredEnabled: value.desiredEnabled,
            method: value.desiredEnabled
                ? value.method as SyncInstallMethod
                : null
        };
    }
}
