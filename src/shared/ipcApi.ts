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
    ModSyncProgress,
    ModLibraryStorageSummary
} from "./mod.js";
import type {
    AutomaticUpdatePreferenceRequest,
    AutomaticUpdatePreferences,
    UpdateCheckMode,
    UpdateCheckResult,
    UpdateSettingsState,
    ApplicationUpdateDownloadProgress,
    ApplicationUpdateDownloadResult
} from "./updates.js";
import type {
    CharacterCatalog,
    CatalogIconRepairProgress,
    CatalogIconRepairResult,
    CatalogBackgroundRepairProgress,
    CatalogBackgroundRepairResult,
    StaticModPreviewPreparation
} from "./characters.js";
import type { GameLocationResult, SetupState, GameLocationChangeProgress, GameLocationChangeResult, GameLocationSelectionResult } from "./setup.js";
import type { ApplicationInfo, ExternalApplicationPage, ApplicationLogEntry, ApplicationLogWriteRequest } from "./application.js";
import type { PluginInstallResult, PluginProgress, PluginConfiguration, PluginConfigurationSaveRequest } from "./plugin.js";
import type { TemporaryFileCleanupResult } from "./maintenance.js";
import type { GameLaunchRequest } from "./game.js";

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
    getUpdateSettings: () => Promise<UpdateSettingsState>;
    setAutomaticUpdatePreference: (request: AutomaticUpdatePreferenceRequest) => Promise<AutomaticUpdatePreferences>;
    checkForUpdates: (mode: UpdateCheckMode) => Promise<UpdateCheckResult>;
    downloadApplicationUpdate: () => Promise<ApplicationUpdateDownloadResult>;
    onApplicationUpdateDownloadProgress: (callback: (progress: ApplicationUpdateDownloadProgress) => void) => () => void;
    installApplicationUpdate: () => Promise<void>;
    updateCharacterCatalog: () => Promise<CharacterCatalog>;
    repairCatalogIcons: () => Promise<CatalogIconRepairResult>;
    onCatalogIconRepairProgress: (callback: (progress: CatalogIconRepairProgress) => void) => () => void;
    getModLibraryStorage: () => Promise<ModLibraryStorageSummary>;
    openModLibraryFolder: () => Promise<void>;
    cleanTemporaryFiles: () => Promise<TemporaryFileCleanupResult>;
    openLogFolder: () => Promise<void>;
    getApplicationInfo: () => Promise<ApplicationInfo>;
    openExternalPage: (page: ExternalApplicationPage) => Promise<void>;
    getApplicationLogs: () => Promise<readonly ApplicationLogEntry[]>;
    writeApplicationLog: (request: ApplicationLogWriteRequest) => Promise<void>;
    getLOPluginConfiguration: () => Promise<PluginConfiguration>;
    saveLOPluginConfiguration: (request: PluginConfigurationSaveRequest) => Promise<PluginConfiguration>;
    launchGame: (request: GameLaunchRequest) => Promise<void>;
    repairCatalogBackgrounds: () => Promise<CatalogBackgroundRepairResult>;
    onCatalogBackgroundRepairProgress: (callback: (progress: CatalogBackgroundRepairProgress) => void) => () => void;
    prepareStaticModPreview: (modId: string) => Promise<StaticModPreviewPreparation>;
};
