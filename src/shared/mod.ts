export type ModImportMode = "single" | "batch";
export type ModSourceKind = "zip" | "asset-bundle";

export type SelectedModSource = {
    name: string;
    kind: ModSourceKind;
    size: number;
};

export type ModSourceSelectionResult = {
    success: boolean;
    canceled: boolean;
    message: string;
    sources: SelectedModSource[];
};
