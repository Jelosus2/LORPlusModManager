export type TemporaryFileCleanupResult = Readonly<{
    removedLocations: number;
    failedLocations: number;
    failureMessages: readonly string[];
}>;
