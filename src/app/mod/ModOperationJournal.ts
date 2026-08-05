import { ModRepository } from "#database/repositories/ModRepository.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type OperationManifestMods = {
    modId: string;
    directoryName: string;
}

type ImportOperationManifest = {
    version: 1;
    kind: "import";
    id: string;
    stagingDirectoryName: string;
    mods: OperationManifestMods[];
};

type DeleteOperationManifest = {
    version: 1;
    kind: "delete";
    id: string;
    modId: string;
    directoryName: string;
    trashDirectoryName: string;
};

type RenameOperationManifest = {
    version: 1;
    kind: "rename";
    id: string;
    modId: string;
    previousDirectoryName: string;
    nextDirectoryName: string;
    temporaryDirectoryName: string | null;
};

type OperationManifest =
    | ImportOperationManifest
    | DeleteOperationManifest
    | RenameOperationManifest;

export type DeleteOperation = {
    id: string;
    trashDirectory: string;
};

export type RenameOperation = {
    id: string;
    temporaryDirectory: string | null;
};

export class ModOperationJournal {
    private readonly modRepository = new ModRepository();

    async beginImport(stagingRoot: string, mods: readonly OperationManifestMods[]): Promise<{ id: string }> {
        const modsRoot = Paths.getModsPath();
        const stagingDirectoryName = Paths.getDirectChildName(modsRoot, stagingRoot);

        if (!stagingDirectoryName)
            throw new Error("The operation directory is invalid.");
        if (!stagingDirectoryName.startsWith(".staging-"))
            throw new Error("The import staging directory is invalid.");

        const id = randomUUID();

        await this.writeManifest({
            version: 1,
            kind: "import",
            id,
            stagingDirectoryName,
            mods: mods.map((mod) => ({
                modId: mod.modId,
                directoryName: mod.directoryName
            }))
        });

        return { id };
    }

    async beginDelete(modId: string, directoryName: string): Promise<DeleteOperation> {
        const id = randomUUID();
        const trashDirectoryName = id;

        await this.writeManifest({
            version: 1,
            kind: "delete",
            id,
            modId,
            directoryName,
            trashDirectoryName
        });

        return {
            id,
            trashDirectory: path.join(Paths.getModsTrashRoot(), trashDirectoryName)
        };
    }

    async beginRename(modId: string, previousDirectoryName: string, nextDirectoryName: string, needsTemporaryDirectory: boolean): Promise<RenameOperation> {
        const id = randomUUID();
        const temporaryDirectoryName = needsTemporaryDirectory
            ? `.rename-${id}`
            : null;

        await this.writeManifest({
            version: 1,
            kind: "rename",
            id,
            modId,
            previousDirectoryName,
            nextDirectoryName,
            temporaryDirectoryName
        });

        return {
            id,
            temporaryDirectory: temporaryDirectoryName
                ? path.join(Paths.getModsPath(), temporaryDirectoryName)
                : null
        };
    }

    async complete(id: string) {
        if (!TypeCheck.isUuid(id))
            throw new Error("The operation ID is invalid.");

        const manifestPath = Paths.getOperationsManifestPath(id);

        await fse.rm(manifestPath, { force: true });
        await fse.rm(`${manifestPath}.tmp`, { force: true });
    }

    async recover() {
        const modsRoot = Paths.getModsPath();
        const operationsRoot = Paths.getOperationsRoot();

        await fse.ensureDir(modsRoot);
        await fse.ensureDir(operationsRoot);

        const operationFiles = await fse.readdir(operationsRoot);
        const failures: Error[] = [];

        for (const fileName of operationFiles)
        {
            if (!fileName.endsWith(".tmp") && !fileName.endsWith(".json"))
                continue;

            const filePath = path.join(operationsRoot, fileName);
            let operationDescription = `operation record "${fileName}"`;

            try
            {
                if (fileName.endsWith(".tmp"))
                {
                    await fse.rm(filePath, { force: true });
                    continue;
                }

                const value: unknown = await fse.readJson(filePath, { encoding: "utf-8" });
                const expectedId = path.basename(fileName, ".json");
                const manifest = this.parseManifest(value, expectedId);

                if (!manifest)
                    throw new Error("The recovery record is invalid or uses an unsupported format.");

                operationDescription = this.describeOperation(manifest);
                await this.recoverManifest(manifest);
            }
            catch (error)
            {
                const failure = ErrorUtils.withContext(`Could not recover ${operationDescription}.`, error, "An unexpected recovery error occurred.");
                failures.push(failure);

                ApplicationLogger.error(ApplicationLogSource.recovery, failure.message, error);
            }
        }

        if (failures.length > 0)
            throw new AggregateError(failures, "One or more interrupted mod operations could not be recovered.");

        await this.removeAbandonedStagingDirectories();
        await this.reportLegacyTemporaryDirectories();
    }

    private async writeManifest(manifest: OperationManifest) {
        const operationsRoot = Paths.getOperationsRoot();
        await fse.ensureDir(operationsRoot);

        const manifestPath = Paths.getOperationsManifestPath(manifest.id);
        const tempPath = `${manifestPath}.tmp`;

        await fse.writeJson(tempPath, manifest, { spaces: 2, encoding: "utf-8" });
        await fse.move(tempPath, manifestPath);
    }

    private async recoverManifest(manifest: OperationManifest) {
        const mods = this.modRepository.getAll();
        const modsById = new Map(mods.map((mod) => [mod.id, mod] as const));
        const directoryOwners = new Map(mods.map((mod) => [Paths.normalizeDirectoryName(mod.directoryName), mod.id] as const));

        if (manifest.kind === "import")
        {
            await this.recoverImport(manifest, modsById, directoryOwners);
            return;
        }

        if (manifest.kind === "delete")
        {
            await this.recoverDelete(manifest, modsById);
            return;
        }

        await this.recoverRename(manifest, modsById);
    }

    private parseManifest(value: unknown, expectedId: string): OperationManifest | null {
        if (!TypeCheck.isRecord(value))
            return null;
        if (value.version !== 1 || !TypeCheck.isUuid(value.id) || value.id !== expectedId)
            return null;

        if (value.kind === "import")
        {
            if (
                !Paths.isSafeDirectoryName(value.stagingDirectoryName) ||
                !value.stagingDirectoryName.startsWith(".staging-") ||
                !TypeCheck.isValidArray(value.mods)
            )
            {
                return null;
            }

            const mods: ImportOperationManifest["mods"] = [];

            for (const item of value.mods)
            {
                if (!TypeCheck.isRecord(item) || !TypeCheck.isUuid(item.modId) || !Paths.isSafeModDirectoryName(item.directoryName))
                    return null;

                mods.push({
                    modId: item.modId,
                    directoryName: item.directoryName
                });
            }

            return {
                version: 1,
                kind: "import",
                id: value.id,
                stagingDirectoryName: value.stagingDirectoryName,
                mods
            };
        }

        if (value.kind === "delete")
        {
            if (!TypeCheck.isUuid(value.modId) || !Paths.isSafeModDirectoryName(value.directoryName) || value.trashDirectoryName !== value.id)
                return null;

            return {
                version: 1,
                kind: "delete",
                id: value.id,
                modId: value.modId,
                directoryName: value.directoryName,
                trashDirectoryName: value.trashDirectoryName
            };
        }

        if (value.kind === "rename")
        {
            if (
                !TypeCheck.isUuid(value.modId) ||
                !Paths.isSafeModDirectoryName(value.previousDirectoryName) ||
                !Paths.isSafeModDirectoryName(value.nextDirectoryName)
            )
            {
                return null;
            }

            if (
                value.temporaryDirectoryName !== null &&
                (value.temporaryDirectoryName !== `.rename-${value.id}` || !Paths.isSafeDirectoryName(value.temporaryDirectoryName))
            )
            {
                return null;
            }

            return {
                version: 1,
                kind: "rename",
                id: value.id,
                modId: value.modId,
                previousDirectoryName: value.previousDirectoryName,
                nextDirectoryName: value.nextDirectoryName,
                temporaryDirectoryName: value.temporaryDirectoryName
            };
        }

        return null;
    }

    private async recoverImport(
        manifest: ImportOperationManifest,
        modsById: ReadonlyMap<string, { directoryName: string }>,
        directoryOwners: ReadonlyMap<string, string>
    ) {
        const registeredCount = manifest.mods.reduce((count, mod) => count + Number(modsById.has(mod.modId)), 0);
        if (registeredCount !== 0 && registeredCount !== manifest.mods.length)
            throw new Error("The import is only partially registered in the database.");

        const modsRoot = Paths.getModsPath();

        if (registeredCount === 0)
        {
            for (const mod of manifest.mods)
            {
                const ownerId = directoryOwners.get(Paths.normalizeDirectoryName(mod.directoryName));
                if (ownerId)
                {
                    ApplicationLogger.warning(ApplicationLogSource.recovery, `Not removing ${mod.directoryName}; it belongs to another registered mod.`);
                    continue;
                }

                await fse.rm(path.join(modsRoot, mod.directoryName), { recursive: true, force: true });
            }
        }

        await fse.rm(path.join(modsRoot, manifest.stagingDirectoryName), { recursive: true, force: true });
        await this.complete(manifest.id);
    }

    private async recoverDelete(manifest: DeleteOperationManifest, modsById: ReadonlyMap<string, { directoryName: string }>) {
        const modsRoot = Paths.getModsPath();
        const originalDirectory = path.join(modsRoot, manifest.directoryName);
        const trashDirectory = path.join(Paths.getModsTrashRoot(), manifest.trashDirectoryName);

        const registeredMod = modsById.get(manifest.modId);
        if (!registeredMod)
        {
            await fse.rm(trashDirectory, { recursive: true, force: true });
            await this.complete(manifest.id);
            return;
        }

        if (!await fse.exists(trashDirectory))
        {
            await this.complete(manifest.id);
            return;
        }

        if (Paths.normalizeDirectoryName(registeredMod.directoryName) !== Paths.normalizeDirectoryName(manifest.directoryName))
            throw new Error("The registered mod now uses a different directory.");
        if (await fse.exists(originalDirectory))
            throw new Error("Both the original and trashed mod directories exist.");

        await fse.move(trashDirectory, originalDirectory);
        await this.complete(manifest.id);
    }

    private async recoverRename(manifest: RenameOperationManifest, modsById: ReadonlyMap<string, { directoryName: string }>) {
        const registeredMod = modsById.get(manifest.modId);
        if (!registeredMod)
            throw new Error("The renamed mod is no longer registered.");

        const registeredName = registeredMod.directoryName;
        const registeredKey = Paths.normalizeDirectoryName(registeredName);
        const previousKey = Paths.normalizeDirectoryName(manifest.previousDirectoryName);
        const nextKey = Paths.normalizeDirectoryName(manifest.nextDirectoryName);

        if (registeredKey !== previousKey && registeredKey !== nextKey)
            throw new Error("The registered mod now uses an unrelated directory.");

        if (previousKey === nextKey)
        {
            await this.recoverCaseOnlyRename(manifest, registeredName);
            await this.complete(manifest.id);
            return;
        }

        const modsRoot = Paths.getModsPath();
        const desiredDirectory = path.join(modsRoot, registeredName);

        const alternateName = registeredKey === previousKey
            ? manifest.nextDirectoryName
            : manifest.previousDirectoryName;
        const alternateDirectory = path.join(modsRoot, alternateName);

        const desiredExists = await fse.exists(desiredDirectory);
        const alternateExists = await fse.exists(alternateDirectory);

        if (desiredExists && alternateExists)
            throw new Error("Both rename destinations exist.");

        if (!desiredExists && alternateExists)
            await fse.move(alternateDirectory, desiredDirectory);

        await this.complete(manifest.id);
    }

    private async recoverCaseOnlyRename(manifest: RenameOperationManifest, registeredName: string) {
        if (!manifest.temporaryDirectoryName)
            throw new Error("The case-only rename has no temporary directory.");

        const modsRoot = Paths.getModsPath();
        const desiredDirectory = path.join(modsRoot, registeredName);
        const temporaryDirectory = path.join(modsRoot, manifest.temporaryDirectoryName);

        const actualDirectory = await this.findDirectChildIgnoringCase(registeredName);
        const temporaryExists = await fse.exists(temporaryDirectory);

        if (temporaryExists)
        {
            if (actualDirectory)
                throw new Error("Both the temporary and renamed directories exist.");

            await fse.move(temporaryDirectory, desiredDirectory);
            return;
        }

        if (!actualDirectory)
            return;
        if (path.basename(actualDirectory) === registeredName)
            return;

        await fse.move(actualDirectory, temporaryDirectory);
        await fse.move(temporaryDirectory, desiredDirectory);
    }

    private async findDirectChildIgnoringCase(directoryName: string): Promise<string | null> {
        const modsRoot = Paths.getModsPath();
        const expectedKey = Paths.normalizeDirectoryName(directoryName);
        const entries = await fse.readdir(modsRoot, { withFileTypes: true });

        const match = entries.find((entry) => entry.isDirectory() && Paths.normalizeDirectoryName(entry.name) === expectedKey);

        return match
            ? path.join(modsRoot, match.name)
            : null;
    }

    private async removeAbandonedStagingDirectories() {
        const modsRoot = Paths.getModsPath();
        const entries = await fse.readdir(modsRoot, { withFileTypes: true });

        for (const entry of entries)
        {
            if (!entry.isDirectory() || !entry.name.startsWith(".staging-"))
                continue;

            await fse.rm(path.join(modsRoot, entry.name), { recursive: true, force: true });
        }
    }

    private async reportLegacyTemporaryDirectories() {
        const modsRoot = Paths.getModsPath();
        const entries = await fse.readdir(modsRoot, { withFileTypes: true });

        const legacyRenames = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(".rename-"));
        if (legacyRenames.length > 0)
            ApplicationLogger.warning(ApplicationLogSource.recovery, `${legacyRenames.length} unjournaled rename directories were left untouched.`);

        const trashRoot = Paths.getModsTrashRoot();

        if (await fse.exists(trashRoot))
        {
            const trashEntries = await fse.readdir(trashRoot);
            if (trashEntries.length > 0)
                ApplicationLogger.warning(ApplicationLogSource.recovery, `${trashEntries.length} unjournaled trash directories were left untouched.`);
        }
    }

    private describeOperation(manifest: OperationManifest): string {
        switch (manifest.kind)
        {
            case "import":
                return `the interrupted import containing ${manifest.mods.length} ${manifest.mods.length === 1 ? "mod" : "mods"}`;
            case "delete":
                return `the interrupted deletion of "${manifest.directoryName}"`;
            case "rename":
                return `the interrupted rename from "${manifest.previousDirectoryName}" to "${manifest.nextDirectoryName}"`;
        }
    }
}
