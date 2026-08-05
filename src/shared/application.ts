export type ExternalApplicationPage = "support" | "repository";

export type ApplicationInfo = Readonly<{
    name: string;
    version: string;
}>;

export type ApplicationLogSeverity = "debug" | "info" | "warning" | "error";

export type ApplicationLogEntry = Readonly<{
    id: string;
    timestamp: string;
    severity: ApplicationLogSeverity;
    source: string;
    message: string;
    details?: string;
}>;

export type ApplicationLogWriteRequest = Readonly<{
    severity: ApplicationLogSeverity;
    source: string;
    message: string;
    details?: string;
}>;

export const ApplicationLogSource = {
    application: "Application",
    environment: "Environment",
    setup: "Game setup",
    plugin: "LOPlugin+",
    modImport: "Mod import",
    modLibrary: "Mod library",
    modSynchronization: "Mod synchronization",
    catalog: "Character catalog",
    updates: "Updates",
    maintenance: "Maintenance",
    diagnostics: "Diagnostics",
    recovery: "Recovery"
} as const;
