import type { PluginInstallResult, PluginProgress } from "./plugin.js";
import type { GameLocationResult } from "./setup.js";

export type IpcApi = {
    setupGameLocation: (manualSetup: boolean) => Promise<GameLocationResult>;
    installLOPlugin: () => Promise<PluginInstallResult>;
    onLOPluginInstallProgress: (callback: (progress: PluginProgress) => void) => () => void;
}
