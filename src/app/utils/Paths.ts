import { TypeCheck } from "./TypeCheck.js";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import path from "node:path";

export class Paths {
    private static appBaseDir = path.dirname(path.join(fileURLToPath(import.meta.url), ".."));

    static getPreloadPath(): string {
        return path.join(Paths.appBaseDir, "preload.js");
    }

    static getRendererHtmlPath(): string {
        return path.join(Paths.appBaseDir, "..", "index.html");
    }

    static getDatabasePath(): string {
        return path.join(app.getPath("userData"), "data.db");
    }

    static getPluginDownloadCachePath(): string {
        return path.join(app.getPath("userData"), "downloads", "LOPlugin+");
    }

    static getPluginInstallationStagingRoot(): string {
        return path.join(app.getPath("temp"), app.getName(), "LOPlugin+");
    }

    static getPluginInstallationStagingPath(version: string): string {
        if (!/^[0-9A-Za-z._-]+$/.test(version))
            throw new Error("Invalid LOPlugin+ version.");

        return path.join(Paths.getPluginInstallationStagingRoot(), version);
    }

    static getBundledCharacterCatalogPath(): string {
        if (app.isPackaged)
            return path.join(process.resourcesPath, "data", "characters.json");

        return path.join(app.getAppPath(), "src", "data", "characters.json");
    }

    static getCachedCharacterCatalogPath(): string {
        return path.join(app.getPath("userData"), "catalogs", "characters.json");
    }

    static getModsPath(): string {
        return path.join(app.getPath("userData"), "mods");
    }

    static getUnityWorkerPath(): string {
        if (app.isPackaged)
            return path.join(process.resourcesPath, "unity-worker", "lorplus-unity-worker.exe");

        return path.join(
            app.getAppPath(),
            "build",
            "unity-worker",
            "win-x64",
            "lorplus-unity-worker",
            "lorplus-unity-worker.exe"
        );
    }

    static getModsTrashRoot(): string {
        return path.join(Paths.getModsPath(), ".trash");
    }

    static getOperationsRoot(): string {
        return path.join(Paths.getModsPath(), ".operations");
    }

    static getOperationsManifestPath(id: string): string {
        return path.join(this.getOperationsRoot(), `${id}.json`);
    }

    static getSyncOperationsRoot(): string {
        return path.join(Paths.getModsPath(), ".sync-operations");
    }

    static getSyncOperationManifestPath(id: string): string {
        return path.join(Paths.getSyncOperationsRoot(), `${id}.json`);
    }

    static getGamePluginRoot(gameLocation: string): string {
        return path.join(gameLocation, "BepInEx", "plugins", "LOPlugin+");
    }

    static getGameModsPath(gameLocation: string): string {
        return path.join(Paths.getGamePluginRoot(gameLocation), "mods");
    }

    static getGameSyncWorkRoot(gameLocation: string): string {
        return path.join(Paths.getGamePluginRoot(gameLocation), ".lorplus-sync");
    }

    static getCachedCharacterIconsPath(): string {
        return path.join(app.getPath("userData"), "catalogs", "icons");
    }

    static getCachedCharacterIconPath(iconFile: string): string {
        return path.join(Paths.getCachedCharacterIconsPath(), iconFile);
    }

    static getLogsPath(): string {
        return app.getPath("logs");
    }

    static getWindowIconPath(): string | undefined {
        if (app.isPackaged)
            return undefined;

        return path.join(app.getAppPath(), "build", "icon.ico");
    }

    static isSubpath(parentPath: string, childPath: string): boolean {
        const relative = path.relative(parentPath, childPath);
        return Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    }

    static sanitizeDirectoryName(name: string, defaultName: string, maxLength: number): string {
        let sanitized = name
            .normalize("NFKC")
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
            .replace(/[. ]+$/g, "")
            .trim();

        if (!sanitized)
            sanitized = defaultName;

        if (sanitized.startsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized))
            sanitized = `_${sanitized}`;

        return sanitized.slice(0, maxLength);
    }

    static getDirectChildName(parent: string, child: string): string | null {
        const relative = path.relative(parent, child);

        if (!Paths.isSubpath(parent, child) || relative.includes(path.sep))
            return null;

        return relative;
    }

    static normalizeDirectoryName(value: string): string {
        return value.toLocaleLowerCase("en-US");
    }

    static isSafeDirectoryName(value: unknown): value is string {
        return (
            TypeCheck.isValidString(value, 100) &&
            value !== "." &&
            value !== ".." &&
            path.basename(value) === value
        );
    }

    static isSafeModDirectoryName(value: unknown): value is string {
        return Paths.isSafeDirectoryName(value) && !value.startsWith(".");
    }

    static isSafeCatalogIconName(value: unknown): value is string {
        return (
            Paths.isSafeDirectoryName(value) &&
            value === value.trim() &&
            !value.startsWith(".") &&
            !/[. ]$/.test(value) &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) &&
            path.extname(value).toLowerCase() === ".png"
        );
    }
}
