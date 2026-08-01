export type GameLocationResult = {
    success: boolean;
    path: string;
    message: string;
};

export type SetupState = {
    isComplete: boolean;
    gameLocation: string | null;
    pluginVersion: string | null;
};

export type GameLocationSelectionResult = GameLocationResult & {
    canceled: boolean;
};

export type GameLocationChangeProgress = {
    progress: number;
    status: string;
    detail: string;
};

export type GameLocationChangeResult = {
    success: boolean;
    message: string;
    gameLocation?: string;
    pluginVersion?: string;
};
