import type { PluginDownloadProgress, PluginDownloadResult } from "./plugin.js";
import type { GameLocationResult } from "./setup.js";

export type IpcApi = {
    setupGameLocation: (manualSetup: boolean) => Promise<GameLocationResult>;
    downloadLOPlugin: () => Promise<PluginDownloadResult>;
    onLOPluginDownloadProgress: (callback: (progress: PluginDownloadProgress) => void) => () => void;
}
