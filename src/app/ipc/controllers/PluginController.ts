import type { PluginInstallResult, PluginProgress } from "../../../shared/plugin.js";
import type { IpcMainInvokeEvent } from "electron";

import { LOPluginDownloader } from "#plugin/LOPluginDownloader.js";
import { LOPluginInstaller } from "#plugin/LOPluginInstaller.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { IpcHelper } from "#ipc/IpcHelper.js";

export class PluginController {
    private readonly downloader = new LOPluginDownloader();
    private readonly installer = new LOPluginInstaller();
    private isInstalling = false;

    @IpcHelper.IpcHandle("plugin:install")
    async installPlugin(event: IpcMainInvokeEvent): Promise<PluginInstallResult> {
        if (this.isInstalling)
            return { success: false, message: "LOPlugin+ is already being installed." };

        this.isInstalling = true;

        const sendProgress = (progress: PluginProgress) => {
            if (!event.sender.isDestroyed())
                event.sender.send("plugin:install-progress", progress);
        };

        try
        {
            const release = await this.downloader.download((progress) => {
                sendProgress({
                    ...progress,
                    progress: progress.progress * 0.7
                });
            });

            await this.installer.install(release, (progress) => {
                sendProgress({
                    ...progress,
                    progress: 70 + progress.progress * 0.3
                });
            });

            return { success: true, message: "", version: release.version };
        }
        catch (error)
        {
            console.error("Failed to install LOPlugin+:", error);

            return {
                success: false,
                message: ErrorUtils.getUserErrorMessage(error, "An unexpected LOPlugin+ installation error occurred.")
            };
        }
        finally
        {
            this.isInstalling = false;
        }
    }
}
