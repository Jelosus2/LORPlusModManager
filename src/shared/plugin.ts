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
