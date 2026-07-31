import type {
    ModImportIssueKind,
    ModImportMode,
    ModSourceKind,
    ModSourceSelectionResult,
    SelectedModSource,
    ModExtractionRequest,
    ModExtractionResult,
    InstalledMod,
    ModSyncRequest,
    ModSyncResult
} from "../../../shared/mod.js";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";

import { ModImporter, ModImportError, type ModImportSource } from "#mod/ModImporter.js";
import { ModLibraryService, ModLibraryError } from "#mod/ModLibraryService.js";
import { ModRecoveryCoordinator } from "#mod/ModRecoveryCoordinator.js";
import { AdminPrivilegeService } from "#utils/AdminPrivilegeService.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { ModSynchronizer } from "#mod/ModSynchronizer.js";
import { ModVerifier } from "#mod/ModVerifier.js";
import { BrowserWindow, dialog } from "electron";
import { TypeCheck } from "#utils/TypeCheck.js";
import { IpcHelper } from "#ipc/IpcHelper.js";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

type StoredModSource = SelectedModSource & {
    filePath: string;
};

type ImportSession = {
    lastAccessedAt: number;
    sources: Map<string, StoredModSource>;
};

export class ModController {
    private readonly sessions = new Map<string, ImportSession>();
    private readonly SESSION_LIFETIME = 30 * 60 * 1000;
    private readonly modImporter = new ModImporter();
    private readonly modRepository = new ModRepository();
    private readonly modVerifier = new ModVerifier();
    private readonly modLibrary = new ModLibraryService();
    private readonly modSynchronizer = new ModSynchronizer();
    private isSynchronizing = false;

    @IpcHelper.IpcHandle("mod:select-sources")
    async selectSources(event: IpcMainInvokeEvent, mode: ModImportMode): Promise<ModSourceSelectionResult> {
        this.pruneExpiredSessions();

        if (mode !== "single" && mode !== "batch")
            return this.selectSourcesFailure("Invalid import mode.");

        const window = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];

        const title = mode === "batch"
            ? "Select mods to import"
            : "Select a mod to import";

        const properties: OpenDialogOptions["properties"] = mode === "batch"
            ? ["openFile", "multiSelections"]
            : ["openFile"];

        const result = await dialog.showOpenDialog(window, {
            title,
            properties
        });

        if (result.canceled)
            return this.selectSourcesFailure("", true);

        const inspectedSources = await Promise.all(result.filePaths.map((filePath) => this.inspectSource(filePath)));
        const unsupportedFiles = result.filePaths
            .filter((_, index) => inspectedSources[index] === null)
            .map((filePath) => path.basename(filePath));

        if (unsupportedFiles.length > 0)
            return this.selectSourcesFailure(`Unsupported or invalid files: ${unsupportedFiles.join(", ")}`);

        const sources = inspectedSources.filter((source): source is StoredModSource => source !== null);

        const sessionId = randomUUID();

        this.sessions.set(sessionId, {
            lastAccessedAt: Date.now(),
            sources: new Map(sources.map((source) => [source.id, source]))
        });

        return {
            success: true,
            canceled: false,
            message: `${sources.length} ${sources.length === 1 ? "mod" : "mods"} selected.`,
            sessionId,
            sources: sources.map((source) => ({
                id: source.id,
                name: source.name,
                kind: source.kind,
                size: source.size
            }))
        };
    }

    @IpcHelper.IpcHandle("mod:extract")
    async extractMods(event: IpcMainInvokeEvent, value: unknown): Promise<ModExtractionResult> {
        const request = this.parseExtractionRequest(value);
        if (!request)
            return this.extractionFailure("Invalid mod extraction request.", "invalid");

        this.pruneExpiredSessions();

        const session = this.sessions.get(request.sessionId);
        if (!session)
            return this.extractionFailure("The import session has expired. Select the files again.", "session");

        session.lastAccessedAt = Date.now();

        const sources: ModImportSource[] = [];

        for (const options of request.sources)
        {
            const source = session.sources.get(options.sourceId);
            if (!source)
                return this.extractionFailure("A selected mod is no longer available.", "invalid");

            sources.push({
                id: source.id,
                name: source.name,
                kind: source.kind,
                filePath: source.filePath,
                password: options.password,
                directoryName: options.directoryName
            });
        }

        try
        {
            const result = await this.modImporter.extract(sources, request.deleteOriginals, (progress) => {
                session.lastAccessedAt = Date.now();

                if (!event.sender.isDestroyed())
                    event.sender.send("mod:import-progress", progress);
            });

            for (const sourceId of result.importedSourceIds)
                session.sources.delete(sourceId);

            if (session.sources.size === 0)
                this.sessions.delete(request.sessionId);
            else
                session.lastAccessedAt = Date.now();

            return result;
        }
        catch (error)
        {
            console.error("Could not import the selected mods:", error);

            const message = error instanceof ModImportError
                ? error.message
                : "The selected mod files could not be imported.";

            return this.extractionFailure(message);
        }
    }

    @IpcHelper.IpcHandle("mod:get-all")
    getMods(): Promise<readonly InstalledMod[]> {
        const mods = this.modRepository.getAll();
        return this.modVerifier.verifyAll(mods);
    }

    @IpcHelper.IpcHandle("mod:open-folder")
    async openModFolder(_event: IpcMainInvokeEvent, value: unknown) {
        const modId = this.parseModId(value);
        await this.modLibrary.openFolder(modId);
    }

    @IpcHelper.IpcHandle("mod:delete")
    async deleteMod(_event: IpcMainInvokeEvent, value: unknown) {
        const modId = this.parseModId(value);
        await this.modLibrary.delete(modId);
    }

    @IpcHelper.IpcHandle("mod:delete-many")
    async deleteMods(_event: IpcMainInvokeEvent, value: unknown) {
        if (!TypeCheck.isValidArray(value))
            throw new ModLibraryError("Invalid bulk deletion request.");

        const modIds: string[] = [];
        const uniqueIds = new Set<string>();

        for (const modId of value)
        {
            if (!TypeCheck.isValidString(modId, 100) || uniqueIds.has(modId))
                throw new ModLibraryError("Invalid bulk deletion request.");

            uniqueIds.add(modId);
            modIds.push(modId);
        }

        return this.modLibrary.deleteMany(modIds);
    }

    @IpcHelper.IpcHandle("mod:rename")
    async renameMod(_event: IpcMainInvokeEvent, value: unknown) {
        if (!TypeCheck.isRecord(value) || !TypeCheck.isValidString(value.modId, 100) || !TypeCheck.isValidString(value.directoryName, 100))
            throw new ModLibraryError("Invalid mod rename request.");

        await this.modLibrary.rename(value.modId, value.directoryName);
    }

    @IpcHelper.IpcHandle("mod:startup-recover")
    async recoverMods() {
        await ModRecoveryCoordinator.waitUntilReady();
    }

    private async inspectSource(filePath: string): Promise<StoredModSource | null> {
        await using file = await fsp.open(filePath, "r");

        const stats = await file.stat();
        if (!stats.isFile())
            return null;

        const header = Buffer.alloc(16);
        const { bytesRead } = await file.read(header, 0, header.length, 0);

        const kind = this.detectSourceKind(header.subarray(0, bytesRead));
        if (!kind)
            return null;

        return {
            id: randomUUID(),
            name: path.basename(filePath),
            kind,
            size: stats.size,
            filePath
        };
    }

    @IpcHelper.IpcHandle("mod:sync")
    async synchronizeMods(event: IpcMainInvokeEvent, value: unknown): Promise<ModSyncResult> {
        const request = this.parseSyncRequest(value);

        if (!request)
            throw new Error("Invalid mod synchronization request.");
        if (this.isSynchronizing)
            throw new Error("Mod synchronization is already running.");

        this.isSynchronizing = true;

        try
        {
            if (request.method === "symlink" && !await AdminPrivilegeService.hasAdminPrivileges())
                throw new Error("Administrator privileges are required to use symbolic links.");

            return await this.modSynchronizer.synchronize(request, (progress) => {
                if (!event.sender.isDestroyed())
                    event.sender.send("mod:sync-progress", progress);
            });
        }
        finally
        {
            this.isSynchronizing = false;
        }
    }

    private detectSourceKind(header: Buffer): ModSourceKind | null {
        const isZip =
            header.length >= 4 &&
            header[0] === 0x50 &&
            header[1] === 0x4b &&
            (
                (header[2] === 0x03 && header[3] === 0x04) ||
                (header[2] === 0x05 && header[3] === 0x06) ||
                (header[2] === 0x07 && header[3] === 0x08)
            );

        if (isZip)
            return "zip";

        const signature = header.toString("ascii");
        if (signature.startsWith("UnityFS"))
            return "asset-bundle";

        return null;
    }

    private parseExtractionRequest(value: unknown): ModExtractionRequest | null {
        if (!TypeCheck.isRecord(value))
            return null;
        if (!TypeCheck.isValidString(value.sessionId, 100) || !TypeCheck.isBoolean(value.deleteOriginals) || !TypeCheck.isValidArray(value.sources, 100))
            return null;

        const sourceIds = new Set<string>();
        const sources: ModExtractionRequest["sources"] = [];

        for (const source of value.sources)
        {
            if (
                !TypeCheck.isRecord(source) ||
                !TypeCheck.isValidString(source.sourceId, 100) ||
                !TypeCheck.isString(source.password, 1024) ||
                !TypeCheck.isString(source.directoryName, 100) ||
                sourceIds.has(source.sourceId)
            )
            {
                return null;
            }

            sourceIds.add(source.sourceId);

            sources.push({
                sourceId: source.sourceId,
                password: source.password,
                directoryName: source.directoryName
            });
        }

        return {
            sessionId: value.sessionId,
            sources,
            deleteOriginals: value.deleteOriginals
        };
    }

    private parseSyncRequest(value: unknown): ModSyncRequest | null {
        if (!TypeCheck.isRecord(value))
            return null;
        if (value.method !== "copy" && value.method !== "symlink" && value.method !== "unsync")
            return null;
        if (!Array.isArray(value.enabledModIds))
            return null;

        const enabledModIds: string[] = [];
        const uniqueIds = new Set<string>();

        for (const modId of value.enabledModIds)
        {
            if (!TypeCheck.isUuid(modId) || uniqueIds.has(modId))
                return null;

            uniqueIds.add(modId);
            enabledModIds.push(modId);
        }

        return {
            method: value.method,
            enabledModIds: value.method === "unsync"
                ? []
                : enabledModIds
        };
    }

    private parseModId(value: unknown): string {
        if (!TypeCheck.isValidString(value, 100))
            throw new ModLibraryError("Invalid mod identifier.");

        return value;
    }

    private pruneExpiredSessions() {
        const now = Date.now();

        for (const [sessionId, session] of this.sessions)
        {
            if (now - session.lastAccessedAt > this.SESSION_LIFETIME)
                this.sessions.delete(sessionId);
        }
    }

    private selectSourcesFailure(message: string, canceled = false): ModSourceSelectionResult {
        return {
            success: false,
            canceled,
            message,
            sessionId: null,
            sources: []
        };
    }

    private extractionFailure(message: string, kind: ModImportIssueKind = "extraction"): ModExtractionResult {
        return {
            success: false,
            message,
            importedSourceIds: [],
            mods: [],
            warnings: [],
            issues: [
                {
                    sourceId: null,
                    sourceName: "Import",
                    kind,
                    message,
                    candidates: []
                }
            ]
        };
    }
}
