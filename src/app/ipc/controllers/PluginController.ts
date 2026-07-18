import type { PluginDownloadResult } from "../../../shared/plugin.js";
import type { IpcMainInvokeEvent } from "electron";

import { LOPluginDownloader } from "#download/LOPluginDownloader.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class PluginController {
    private readonly downloader = new LOPluginDownloader();
    private isDownloading = false;

    @IpcHelper.IpcHandle("plugin:download")
    async downloadPlugin(event: IpcMainInvokeEvent): Promise<PluginDownloadResult> {
        if (this.isDownloading)
            return { success: false, message: "LOPlugin+ is already being downloaded." };

        this.isDownloading = true;

        try {
            const release = await this.downloader.download((progress) => {
                if (event.sender.isDestroyed())
                    return;

                event.sender.send("plugin:download-progress", progress);
            });

            return { success: true, message: "", version: release.version };
        } catch (error) {
            console.error("Failed to download LOPlugin+:", error);

            return {
                success: false,
                message: error instanceof Error
                    ? error.message
                    : "An unexpected download error occurred."
            };
        } finally {
            this.isDownloading = false;
        }
    }
}
