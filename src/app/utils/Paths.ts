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

    static getPluginInstallationStagingPath(version: string) {
        if (!/^[0-9A-Za-z._-]+$/.test(version))
            throw new Error("Invalid LOPlugin+ version.");

        return path.join(app.getPath("temp"), app.getName(), "LOPlugin+", version);
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
}
