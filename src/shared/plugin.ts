export type PluginProgress = {
    status: string;
    progress: number;
    downloadedBytes?: number;
    totalBytes?: number;
};

export type PluginInstallResult = {
    success: boolean;
    message: string;
    version?: string;
};

export type PluginConfigurationValueKind =
    | "boolean"
    | "number"
    | "string"
    | "keyCode"
    | "unknown";

export type PluginConfigurationEntry = Readonly<{
    key: string;
    description: string;
    settingType: string;
    valueKind: PluginConfigurationValueKind;
    value: string;
    defaultValue: string;
    acceptableValues: readonly string[];
}>;

export type PluginConfigurationSection = Readonly<{
    id: string;
    name: string;
    entries: readonly PluginConfigurationEntry[];
}>;

export type PluginConfigurationUpdate = Readonly<{
    section: string;
    key: string;
    value: string;
}>;

export type PluginConfigurationSaveRequest = Readonly<{
    revision: string;
    updates: readonly PluginConfigurationUpdate[];
}>;

export type PluginConfiguration = Readonly<{
    exists: boolean;
    filePath: string;
    revision: string | null;
    sections: readonly PluginConfigurationSection[];
}>;
