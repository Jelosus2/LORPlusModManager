import { fileURLToPath } from "node:url";
import { app } from "electron";
import path from "node:path";

export class Paths {
    private static appBaseDir = path.dirname(path.join(fileURLToPath(import.meta.url), ".."));

    static getPreloadPath() {
        return path.join(Paths.appBaseDir, "preload.js");
    }

    static getRendererHtmlPath() {
        return path.join(Paths.appBaseDir, "..", "index.html");
    }

    static getDatabasePath() {
        return path.join(app.getPath("userData"), "data.db");
    }

    static getPluginDownloadCachePath() {
        return path.join(app.getPath("userData"), "downloads", "LOPlugin+");
    }
}
