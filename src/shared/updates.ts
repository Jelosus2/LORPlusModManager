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

export type ApplicationUpdateManifest = Readonly<{
    version: string;
    mandatory: boolean;
    minimumVersion?: string;
}>;

export type ComponentUpdateResult = Readonly<{
    component: UpdateComponent;
    status: UpdateCheckStatus;
    installedVersion: string | null;
    latestVersion: string | null;
    required: boolean;
    message: string;
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
