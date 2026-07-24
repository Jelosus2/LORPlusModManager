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

export type ZipExtractionOptions = {
    sourceId: string;
    password: string;
};

export type ZipExtractionRequest = {
    sessionId: string;
    sources: ZipExtractionOptions[];
    deleteOriginals: boolean;
};

export type ExtractedModSummary = {
    sourceName: string;
    characterName: string;
    skinName: string;
    skin2dId: string;
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

export type ZipExtractionResult = {
    success: boolean;
    message: string;
    mods: ExtractedModSummary[];
    warnings: string[];
    issues: ModImportIssue[];
};
