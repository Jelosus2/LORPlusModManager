import type { ModImportMode, ModSourceSelectionResult, ModExtractionRequest, ModExtractionResult, InstalledMod } from "./mod.js";
import type { PluginInstallResult, PluginProgress } from "./plugin.js";
import type { GameLocationResult, SetupState } from "./setup.js";
import type { CharacterCatalog } from "./characters.js";

export type IpcApi = {
    setupGameLocation: (manualSetup: boolean) => Promise<GameLocationResult>;
    installLOPlugin: () => Promise<PluginInstallResult>;
    onLOPluginInstallProgress: (callback: (progress: PluginProgress) => void) => () => void;
    getSetupState: () => Promise<SetupState>;
    getCharacterCatalog: () => Promise<CharacterCatalog>;
    selectModSources: (mode: ModImportMode) => Promise<ModSourceSelectionResult>;
    extractMods: (request: ModExtractionRequest) => Promise<ModExtractionResult>;
    getMods: () => Promise<readonly InstalledMod[]>;
    setModEnabled: (modId: string, enabled: boolean) => Promise<void>;
};
