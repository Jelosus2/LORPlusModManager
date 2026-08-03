export type UpdateComponent =
    | "application"
    | "plugin"
    | "catalog";

export type UpdateCheckMode =
    | "automatic"
    | "manual";

export type UpdateCheckStatus =
    | "not-checked"
    | "up-to-date"
    | "available"
    | "error";

export type AutomaticUpdatePreferences = Readonly<{
    application: boolean;
    plugin: boolean;
    catalog: boolean;
}>;

export type AutomaticUpdatePreferenceRequest = {
    component: UpdateComponent;
    enabled: boolean;
};

export type ComponentUpdateResult = Readonly<{
    component: UpdateComponent;
    status: UpdateCheckStatus;
    installedVersion: string | null;
    latestVersion: string | null;
    message: string;
    release: UpdateReleaseInfo | null;
}>;

export type UpdateCheckResult = Readonly<{
    mode: UpdateCheckMode;
    checkedAt: string;
    components: readonly ComponentUpdateResult[];
}>;

export type InstalledComponentVersions = Readonly<
    Record<UpdateComponent, string | null>
>;

export type UpdateSettingsState = Readonly<{
    preferences: AutomaticUpdatePreferences;
    installedVersions: InstalledComponentVersions;
}>;

export type UpdateReleaseInfo = Readonly<{
    name: string | null;
    notes: string | null;
    date: string | null;
}>;

export type ApplicationUpdateDownloadProgress = Readonly<{
    phase: "downloading" | "ready";
    version: string;
    progress: number;
    transferredBytes: number;
    totalBytes: number;
    bytesPerSecond: number;
}>;

export type ApplicationUpdateDownloadResult = Readonly<{
    version: string;
}>;
