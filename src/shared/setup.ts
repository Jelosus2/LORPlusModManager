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
