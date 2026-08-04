import type { TemporaryFileCleanupResult } from "../../shared/maintenance.js";

import { ErrorUtils } from "#utils/ErrorUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type CleanupCandidate = Readonly<{
    targetPath: string;
    parentPath: string;
    description: string;
}>;

export class TemporaryFileCleanupService {
    private static readonly MAX_REPORTED_FAILURES = 5;
    private static readonly ABANDONED_IMPORT_MINIMUM_AGE = 24 * 60 * 60 * 1000;
    private cleanupPromise: Promise<TemporaryFileCleanupResult> | null = null;

    async clean(): Promise<TemporaryFileCleanupResult> {
        if (this.cleanupPromise)
            return this.cleanupPromise;

        this.cleanupPromise = this.performCleanup();

        try
        {
            return await this.cleanupPromise;
        }
        finally
        {
            this.cleanupPromise = null;
        }
    }

    private async performCleanup(): Promise<TemporaryFileCleanupResult> {
        const candidates: CleanupCandidate[] = [
            {
                targetPath: Paths.getPluginDownloadCachePath(),
                parentPath: path.dirname(Paths.getPluginDownloadCachePath()),
                description: "The cached LOPlugin+ downloads"
            },
            {
                targetPath: Paths.getPluginInstallationStagingRoot(),
                parentPath: path.dirname(Paths.getPluginInstallationStagingRoot()),
                description: "The LOPlugin+ installation staging files"
            }
        ];

        const failureMessages: string[] = [];
        let failedLocations = 0;
        let removedLocations = 0;

        try
        {
            candidates.push(...await this.getAbandonedImportCandidates());
        }
        catch (error)
        {
            failedLocations++;

            this.addFailure(
                failureMessages,
                ErrorUtils.combineWithCause("Abandoned import data could not be inspected.", error, "Windows could not inspect the mod library.")
            );
        }

        for (const candidate of candidates)
        {
            try
            {
                if (!Paths.isSubpath(candidate.parentPath, candidate.targetPath))
                    throw new Error("The temporary directory path is outside its expected location.");
                if (!await fse.exists(candidate.targetPath))
                    continue;

                await fse.rm(candidate.targetPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
                removedLocations++;
            }
            catch (error)
            {
                failedLocations++;

                this.addFailure(
                    failureMessages,
                    ErrorUtils.combineWithCause(`${candidate.description} could not be removed.`, error, "Windows could not remove the files.")
                );
            }
        }

        return Object.freeze({
            removedLocations,
            failedLocations,
            failureMessages: Object.freeze(failureMessages)
        });
    }

    private async getAbandonedImportCandidates(): Promise<CleanupCandidate[]> {
        if (await this.hasRecoveryRecords())
            return [];

        const modsRoot = Paths.getModsPath();
        let entries: fse.Dirent<string>[];

        try
        {
            entries = await fse.readdir(modsRoot, { withFileTypes: true });
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return [];

            throw error;
        }

        const candidates: CleanupCandidate[] = [];
        const now = Date.now();

        for (const entry of entries)
        {
            if (
                !entry.isDirectory() ||
                entry.isSymbolicLink() ||
                !/^\.staging-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name)
            )
            {
                continue;
            }

            const stagingPath = path.join(modsRoot, entry.name);
            const stats = await fse.lstat(stagingPath);

            if (!stats.isDirectory() || stats.isSymbolicLink() || now - stats.mtimeMs < TemporaryFileCleanupService.ABANDONED_IMPORT_MINIMUM_AGE)
                continue;

            candidates.push({
                targetPath: stagingPath,
                parentPath: modsRoot,
                description: `The abandoned import directory "${entry.name}"`
            });
        }

        return candidates;
    }

    private async hasRecoveryRecords(): Promise<boolean> {
        try
        {
            const entries = await fse.readdir(Paths.getOperationsRoot());
            return entries.length > 0;
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                return false;

            throw error;
        }
    }

    private addFailure(messages: string[], message: string) {
        if (messages.length < TemporaryFileCleanupService.MAX_REPORTED_FAILURES)
            messages.push(message);
    }
}

export const temporaryFileCleanupService = new TemporaryFileCleanupService();
