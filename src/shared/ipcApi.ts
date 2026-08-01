import type {
    ModImportMode,
    ModSourceSelectionResult,
    ModExtractionRequest,
    ModExtractionResult,
    InstalledMod,
    ModRenameRequest,
    BulkModDeletionResult,
    ModImportProgress,
    ModSyncRequest,
    ModSyncResult,
    ModSyncProgress
} from "./mod.js";
import type { GameLocationResult, SetupState, GameLocationChangeProgress, GameLocationChangeResult, GameLocationSelectionResult } from "./setup.js";
import type { PluginInstallResult, PluginProgress } from "./plugin.js";
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
    openModFolder: (modId: string) => Promise<void>;
    deleteMod: (modId: string) => Promise<void>;
    renameMod: (request: ModRenameRequest) => Promise<void>;
    deleteMods: (modIds: readonly string[]) => Promise<BulkModDeletionResult>;
    onModImportProgress: (callback: (progress: ModImportProgress) => void) => () => void;
    recoverInterruptedModOperations: () => Promise<void>;
    hasAdminPrivileges: () => Promise<boolean>;
    syncMods: (request: ModSyncRequest) => Promise<ModSyncResult>;
    onModSyncProgress: (callback: (progress: ModSyncProgress) => void) => () => void;
    openRecoveryFolder: () => Promise<void>;
    selectGameLocation: (manualSetup: boolean) => Promise<GameLocationSelectionResult>;
    changeGameLocation: (gameLocation: string) => Promise<GameLocationChangeResult>;
    onGameLocationChangeProgress: (callback: (progress: GameLocationChangeProgress) => void) => () => void;
    openGameLocation: () => Promise<void>;
};
