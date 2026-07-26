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
    mods: ExtractedModSummary[];
    warnings: string[];
    issues: ModImportIssue[];
};
