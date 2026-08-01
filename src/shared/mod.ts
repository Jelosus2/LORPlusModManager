export type ModImportMode = "single" | "batch";
export type ModSourceKind = "zip" | "asset-bundle";

export type SelectedModSource = {
    id: string;
    name: string;
    kind: ModSourceKind;
    size: number;
};

export type ModSourceSelectionResult = {
    success: boolean;
    canceled: boolean;
    message: string;
    sessionId: string | null;
    sources: SelectedModSource[];
};

export type ModExtractionSourceOptions = {
    sourceId: string;
    password: string;
    directoryName: string;
};

export type ModExtractionRequest = {
    sessionId: string;
    sources: ModExtractionSourceOptions[];
    deleteOriginals: boolean;
};

export type ExtractedModSummary = {
    sourceName: string;
    characterName: string;
    skinName: string;
    skin2dId: string;
    variantId: string | null;
    assetCount: number;
};

export type ModImportIssueKind =
    | "incomplete"
    | "ambiguous"
    | "unrecognized"
    | "invalid"
    | "extraction"
    | "session";

export type ModImportCandidate = {
    characterName: string;
    skinName: string;
    skin2dId: string;
    foundAssets: string[];
    missingAssets: string[];
};

export type ModImportIssue = {
    sourceId: string | null;
    sourceName: string;
    kind: ModImportIssueKind;
    message: string;
    candidates: ModImportCandidate[];
};

export type ModExtractionResult = {
    success: boolean;
    message: string;
    importedSourceIds: string[];
    mods: ExtractedModSummary[];
    warnings: string[];
    issues: ModImportIssue[];
};

export type ModVerificationStatus =
    | "valid"
    | "missing-directory"
    | "missing-assets"
    | "unreadable";

export type ModVerification = Readonly<{
    status: ModVerificationStatus;
    missingAssets: readonly string[];
    message: string;
}>;

export type PersistedMod = Readonly<{
    id: string;
    directoryName: string;
    sourceName: string;
    sourceKind: ModSourceKind;
    skin2dId: string;
    variantId: string | null;
    enabled: boolean;
    importedAt: string;
    assetNames: readonly string[];
}>;

export type InstalledMod = PersistedMod & Readonly<{
    verification: ModVerification;
}>;

export type ModRenameRequest = Readonly<{
    modId: string;
    directoryName: string;
}>;

export type ModDeletionFailure = Readonly<{
    modId: string;
    message: string;
}>;

export type BulkModDeletionResult = Readonly<{
    deletedModIds: readonly string[];
    failures: readonly ModDeletionFailure[];
}>;

export type ModImportProgress = Readonly<{
    progress: number;
    status: string;
    detail: string;
    indeterminate?: boolean;
}>;

export type ModSyncMethod = "copy" | "symlink" | "unsync";

export type ModSyncLogStatus =
    | "synced"
    | "failed"
    | "unsynced"
    | "unchanged";

export type ModSyncRequest = Readonly<{
    method: ModSyncMethod;
    enabledModIds: readonly string[];
}>;

export type ModSyncLogEntry = Readonly<{
    modId: string;
    directoryName: string;
    status: ModSyncLogStatus;
    message: string;
}>;

export type ModSyncProgress = Readonly<{
    progress: number;
    status: string;
    detail: string;
    entry: ModSyncLogEntry | null;
}>;

export type ModSyncResult = Readonly<{
    success: boolean;
    message: string;
    entries: readonly ModSyncLogEntry[];
}>;
