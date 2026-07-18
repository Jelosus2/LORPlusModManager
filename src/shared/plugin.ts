export type PluginDownloadProgress = {
    status: string;
    progress: number;
    downloadedBytes: number;
    totalBytes: number;
};

export type PluginDownloadResult = {
    success: boolean;
    message: string;
    version?: string;
};
