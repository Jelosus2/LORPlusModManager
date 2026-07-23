import type { ModImportMode, ModSourceKind, ModSourceSelectionResult, SelectedModSource } from "../../../shared/mod.js";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";

import { BrowserWindow, dialog } from "electron";
import { IpcHelper } from "#ipc/IpcHelper.js";
import fsp from "node:fs/promises";
import path from "node:path";

export class ModController {
    @IpcHelper.IpcHandle("mod:select-sources")
    async selectSources(event: IpcMainInvokeEvent, mode: ModImportMode): Promise<ModSourceSelectionResult> {
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

        const sources = inspectedSources.filter((source): source is SelectedModSource => source !== null);

        return {
            success: true,
            canceled: false,
            message: `${sources.length} ${sources.length === 1 ? "mod" : "mods"} selected.`,
            sources
        };
    }

    private async inspectSource(filePath: string): Promise<SelectedModSource | null> {
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
            name: path.basename(filePath),
            kind,
            size: stats.size
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

    private selectSourcesFailure(message: string, canceled = false): ModSourceSelectionResult {
        return {
            success: false,
            canceled,
            message,
            sources: []
        };
    }
}
