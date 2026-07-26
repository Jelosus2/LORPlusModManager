import type { ModImportIssueKind, ModImportMode, ModSourceKind, ModSourceSelectionResult, SelectedModSource, ModExtractionRequest, ModExtractionResult, InstalledMod } from "../../../shared/mod.js";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";

import { ModImporter, ModImportError, type ModImportSource } from "#mod/ModImporter.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
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
    createdAt: number;
    sources: Map<string, StoredModSource>;
};

export class ModController {
    private readonly sessions = new Map<string, ImportSession>();
    private readonly SESSION_LIFETIME = 30 * 60 * 1000;
    private readonly modImporter = new ModImporter();
    private readonly modRepository = new ModRepository();

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
            createdAt: Date.now(),
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
    async extractMods(_event: IpcMainInvokeEvent, value: unknown): Promise<ModExtractionResult> {
        const request = this.parseExtractionRequest(value);
        if (!request)
            return this.extractionFailure("Invalid mod extraction request.", "invalid");

        this.pruneExpiredSessions();

        const session = this.sessions.get(request.sessionId);
        if (!session)
            return this.extractionFailure("The import session has expired. Select the files again.", "session");

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
            const result = await this.modImporter.extract(sources, request.deleteOriginals);
            if (result.success)
                this.sessions.delete(request.sessionId);

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
    getMods(): readonly InstalledMod[] {
        return this.modRepository.getAll();
    }

    @IpcHelper.IpcHandle("mods:set-enabled")
    setModEnabled(_event: IpcMainInvokeEvent, modId: unknown, enabled: unknown) {
        if (typeof modId !== "string" || !modId.trim() || modId.length > 100 || typeof enabled !== "boolean")
            throw new Error("Invalid mod enabled-state request.");

        if (!this.modRepository.setEnabled(modId, enabled))
            throw new Error("The selected mod could not be found.");
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

        if (
            typeof value.sessionId !== "string" ||
            value.sessionId.length > 100 ||
            typeof value.deleteOriginals !== "boolean" ||
            !Array.isArray(value.sources) ||
            value.sources.length === 0 ||
            value.sources.length > 100
        )
        {
            return null;
        }

        const sourceIds = new Set<string>();
        const sources: ModExtractionRequest["sources"] = [];

        for (const source of value.sources)
        {
            if (
                !TypeCheck.isRecord(source) ||
                typeof source.sourceId !== "string" ||
                source.sourceId.length > 100 ||
                typeof source.password !== "string" ||
                source.password.length > 1024 ||
                typeof source.directoryName !== "string" ||
                source.directoryName.length > 100 ||
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

    private pruneExpiredSessions() {
        const expirationTime = Date.now() - this.SESSION_LIFETIME;

        for (const [sessionId, session] of this.sessions)
        {
            if (session.createdAt < expirationTime)
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
