import type { ExtractedModSummary, ModExtractionResult, ModImportIssue, ModSourceKind, ModImportProgress } from "../../shared/mod.js";
import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";
import type { ImportedModRecord } from "#database/repositories/ModRepository.js";

import { ModRepository } from "#database/repositories/ModRepository.js";
import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { AssetBundleModMatcher } from "./AssetBundleModMatcher.js";
import { ErrorUtils, UserFacingError } from "#utils/ErrorUtils.js";
import { ModOperationJournal } from "./ModOperationJournal.js";
import { UnityWorkerClient } from "./UnityWorkerClient.js";
import { ZipModMatcher } from "./ZipModMatcher.js";
import { ZipArchive } from "#utils/ZipArchive.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type ModImportSource = {
    id: string;
    name: string;
    filePath: string;
    kind: ModSourceKind;
    password: string;
    directoryName: string;
};

type PreparedMatch = {
    character: CharacterSkin;
    assetNames: string[];
    extract: (destination: string) => Promise<void>;
};

type PreparedSource = {
    source: ModImportSource;
    matches: PreparedMatch[];
};

type SourcePreparation = {
    matches: PreparedMatch[];
    incompleteMatches: {
        character: CharacterSkin;
        foundAssets: string[];
        missingAssets: string[];
    }[];
    hasAmbiguousMatches: boolean;
};

type PlannedMod = {
    stagingDirectory: string;
    finalDirectory: string;
    summary: ExtractedModSummary;
    record: ImportedModRecord;
};

type ModImportProgressCallback = (progress: ModImportProgress) => void;
type SourceAnalysisProgressCallback = (fraction: number, status: string, detail: string, indeterminate?: boolean) => void;

type SourceImportOutcome =
    | {
        success: true;
        mods: ExtractedModSummary[];
    }
    | {
        success: false;
        issue: ModImportIssue;
    };

export class ModImportError extends UserFacingError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ModImportError";
    }
}

export class ModImporter {
    private readonly archive = new ZipArchive();
    private readonly zipMatcher = new ZipModMatcher();
    private readonly unityWorker = new UnityWorkerClient();
    private readonly assetBundleMatcher = new AssetBundleModMatcher();
    private readonly modRepository = new ModRepository();
    private readonly operationJournal = new ModOperationJournal();

    async extract(sources: readonly ModImportSource[], deleteOriginals: boolean, reportProgress: ModImportProgressCallback): Promise<ModExtractionResult> {
        if (sources.length === 0)
            throw new ModImportError("No mod files were provided.");

        reportProgress({
            progress: 0,
            status: "Preparing import",
            detail: `Preparing ${sources.length} ${sources.length === 1 ? "file" : "files"}`
        });

        const modsRoot = Paths.getModsPath();
        const stagingRoot = path.join(modsRoot, `.staging-${randomUUID()}`);

        await fse.ensureDir(modsRoot);
        await fse.mkdir(stagingRoot);

        let result: ModExtractionResult;

        try
        {
            result = await this.extractInWorkspace(sources, deleteOriginals, modsRoot, stagingRoot, reportProgress);
        }
        finally
        {
            reportProgress({
                progress: 99,
                status: "Cleaning temporary files",
                detail: "Finishing the import"
            });

            await fse.rm(stagingRoot, { recursive: true, force: true });
        }

        reportProgress({
            progress: 100,
            status: result.success
                ? "Import complete"
                : "Import needs attention",
            detail: result.success
                ? `${result.mods.length} ${result.mods.length === 1 ? "mod" : "mods"} imported`
                : "Review the import results"
        });

        return result;
    }

    private async extractInWorkspace(
        sources: readonly ModImportSource[],
        deleteOriginals: boolean,
        modsRoot: string,
        stagingRoot: string,
        reportProgress: ModImportProgressCallback
    ): Promise<ModExtractionResult> {
        const analysis = await this.analyzeSources(sources, path.join(stagingRoot, "sources"), reportProgress);

        const importedSourceIds: string[] = [];
        const importedSources: ModImportSource[] = [];
        const importedMods: ExtractedModSummary[] = [];
        const warnings: string[] = [];
        const issues = [...analysis.issues];

        const preparedSourceCount = analysis.sources.length;
        const sourceProgressSpan = preparedSourceCount > 0
            ? 54 / preparedSourceCount
            : 0;

        for (let i = 0; i < preparedSourceCount; i++)
        {
            const analyzed = analysis.sources[i];
            const progressStart = 40 + i * sourceProgressSpan;

            const outcome = await this.importPreparedSource(analyzed, modsRoot, stagingRoot, progressStart, sourceProgressSpan, reportProgress);
            if (!outcome.success)
            {
                issues.push(outcome.issue);
                continue;
            }

            importedSourceIds.push(analyzed.source.id);
            importedSources.push(analyzed.source);
            importedMods.push(...outcome.mods);
        }

        if (deleteOriginals)
        {
            for (let i = 0; i < importedSources.length; i++)
            {
                const source = importedSources[i];

                reportProgress({
                    progress: 95 + i / Math.max(importedSources.length, 1) * 3,
                    status: `Removing ${source.name}`,
                    detail: `${i + 1} of ${importedSources.length} ${importedSources.length === 1 ? "original file" : "original files"}`
                });

                try
                {
                    await fse.unlink(source.filePath);
                }
                catch (error)
                {
                    console.error(`Could not delete imported mod ${source.filePath}:`, error);

                    const detail =
                        ErrorUtils.getFsErrorMessage(error, "The original mod file") ||
                        ErrorUtils.getUserErrorMessage(error, "An unexpected filesystem error occurred.");

                    warnings.push(`${source.name} was imported, but its original file could not be deleted. ${detail}`);
                }
            }
        }

        const success = issues.length === 0;
        let message: string;

        if (success)
            message = `${importedMods.length} ${importedMods.length === 1 ? "mod" : "mods"} imported successfully.`;
        else if (importedMods.length > 0)
            message =
                `${importedMods.length} ${importedMods.length === 1 ? "mod was" : "mods were"} imported. ` +
                `${issues.length} ${issues.length === 1 ? "file needs" : "files need"} attention.`;
        else
            message = `${issues.length} ${issues.length === 1 ? "file needs" : "files need"} attention. No mods were imported.`;

        return {
            success,
            message,
            importedSourceIds,
            mods: importedMods,
            warnings,
            issues
        };
    }

    private async importPreparedSource(
        analyzed: PreparedSource,
        modsRoot: string,
        stagingRoot: string,
        progressStart: number,
        progressSpan: number,
        reportProgress: ModImportProgressCallback
    ): Promise<SourceImportOutcome> {
        const source = analyzed.source;
        const sourceWorkspace = path.join(stagingRoot, "mods", randomUUID());
        const reservedDirectories = new Set<string>();
        const plannedMods: PlannedMod[] = [];
        const movedDirectories: string[] = [];

        let operationId: string | null = null;

        try
        {
            const fallbackName = path.basename(source.name, path.extname(source.name));
            const sourceDirectoryName = source.directoryName.trim() || fallbackName;
            const directoryName = Paths.sanitizeDirectoryName(sourceDirectoryName, "mod", 80);
            const containsMultipleMods = analyzed.matches.length > 1;

            for (let i = 0; i < analyzed.matches.length; i++)
            {
                const match = analyzed.matches[i];
                const requestedName = containsMultipleMods
                    ? `${directoryName}-${Paths.sanitizeDirectoryName(match.character.characterName, "mod", 80)}`
                    : directoryName;

                const finalDirectory = await this.reserveDestination(modsRoot, requestedName, reservedDirectories);
                const stagingDirectory = path.join(sourceWorkspace, randomUUID());

                reportProgress({
                    progress: progressStart + i / Math.max(analyzed.matches.length, 1) * progressSpan * 0.7,
                    status: `Extracting ${match.character.characterName}: ${match.character.skinName}`,
                    detail: `${i + 1} of ${analyzed.matches.length} mods · ${source.name}`
                });

                try
                {
                    await match.extract(stagingDirectory);
                }
                catch (error)
                {
                    return {
                        success: false,
                        issue: this.createExtractionIssue(source, error)
                    };
                }

                plannedMods.push({
                    stagingDirectory,
                    finalDirectory,
                    summary: {
                        sourceName: source.name,
                        characterName: match.character.characterName,
                        skinName: match.character.skinName,
                        skin2dId: match.character.skin2dId,
                        variantId: match.character.variantId,
                        assetCount: match.assetNames.length
                    },
                    record: {
                        id: randomUUID(),
                        directoryName: path.basename(finalDirectory),
                        sourceName: source.name,
                        sourceKind: source.kind,
                        skin2dId: match.character.skin2dId,
                        variantId: match.character.variantId,
                        assetNames: [...match.assetNames]
                    }
                });
            }

            const operation = await this.operationJournal.beginImport(
                stagingRoot,
                plannedMods.map(({ record }) => ({
                    modId: record.id,
                    directoryName: record.directoryName
                }))
            );

            operationId = operation.id;

            for (let i = 0; i < plannedMods.length; i++)
            {
                const plannedMod = plannedMods[i];

                reportProgress({
                    progress: progressStart + progressSpan * 0.72 + i / Math.max(plannedMods.length, 1) * progressSpan * 0.18,
                    status: `Saving ${plannedMod.record.directoryName}`,
                    detail: `${i + 1} of ${plannedMods.length} mods · ${source.name}`
                });

                await fse.move(plannedMod.stagingDirectory, plannedMod.finalDirectory);
                movedDirectories.push(plannedMod.finalDirectory);
            }

            reportProgress({
                progress: progressStart + progressSpan * 0.94,
                status: `Registering ${source.name}`,
                detail: `Saving ${plannedMods.length} ${plannedMods.length === 1 ? "mod" : "mods"} to the library`
            });

            this.modRepository.addImportedMods(plannedMods.map(({ record }) => record));

            if (operationId)
            {
                try
                {
                    await this.operationJournal.complete(operationId);
                    operationId = null;
                }
                catch (error)
                {
                    console.error("Could not complete the import operation journal:", error);
                }
            }

            return {
                success: true,
                mods: plannedMods.map(({ summary }) => summary)
            };
        }
        catch (error)
        {
            console.error(`Could not commit ${source.filePath}:`, error);

            const rollbackResults = await Promise.allSettled(
                movedDirectories.map((directory) => fse.rm(directory, { recursive: true, force: true }))
            );

            const rollbackSucceeded = rollbackResults.every((result) => result.status === "fulfilled");

            if (operationId && rollbackSucceeded)
            {
                try
                {
                    await this.operationJournal.complete(operationId);
                    operationId = null;
                }
                catch (recoveryError)
                {
                    console.error("Could not remove the rolled-back import operation:", recoveryError);
                }
            }

            return {
                success: false,
                issue: {
                    sourceId: source.id,
                    sourceName: source.name,
                    kind: "extraction",
                    message: ErrorUtils.combineWithCause("The extracted mods could not be saved.", error),
                    candidates: []
                }
            };
        }
        finally
        {
            try
            {
                await fse.rm(sourceWorkspace, { recursive: true, force: true });
            }
            catch (error)
            {
                console.error(`Could not clean the import workspace for ${source.name}:`, error);
            }
        }
    }

    private async analyzeSources(sources: readonly ModImportSource[], workspaceRoot: string, reportProgress: ModImportProgressCallback): Promise<{
        sources: PreparedSource[];
        issues: ModImportIssue[];
    }> {
        const catalog = await characterCatalog.getCatalog();
        const analyzedSources: PreparedSource[] = [];
        const issues: ModImportIssue[] = [];
        const sourceSpan = 40 / sources.length;

        for (let i = 0; i < sources.length; i++)
        {
            const source = sources[i];
            const sourceStart = i * sourceSpan;

            const reportSourceProgress: SourceAnalysisProgressCallback = (fraction, status, detail, indeterminate = false) => {
                const normalizedFraction = Math.min(1, Math.max(0, fraction));

                reportProgress({
                    progress: sourceStart + normalizedFraction * sourceSpan,
                    status,
                    detail: `${i + 1} of ${sources.length} files · ${detail}`,
                    indeterminate
                });
            }

            reportSourceProgress(0, `Checking ${source.name}`, "Preparing inspection");

            let preparation: SourcePreparation;

            try
            {
                preparation = await this.prepareSource(source, catalog, path.join(workspaceRoot, randomUUID()), reportSourceProgress);
            }
            catch (error)
            {
                console.error(`Could not inspect ${source.filePath}:`, error);

                issues.push(this.createInspectionIssue(source, error));
                reportSourceProgress(1, `Could not inspect ${source.name}`, "Moving to the next file");

                continue;
            }

            const matchingIssue = this.createMatchingIssue(source, preparation);
            if (matchingIssue)
            {
                issues.push(matchingIssue);
            }
            else
            {
                analyzedSources.push({
                    source,
                    matches: preparation.matches
                });
            }

            reportSourceProgress(1, `Checked ${source.name}`, "Inspection complete");
        }

        reportProgress({
            progress: 40,
            status: "File inspection complete",
            detail: `${sources.length} ${sources.length === 1 ? "file" : "files"} checked`
        });

        return {
            sources: analyzedSources,
            issues
        };
    }

    private async prepareSource(
        source: ModImportSource,
        catalog: CharacterCatalog,
        workspaceDirectory: string,
        reportProgress: SourceAnalysisProgressCallback
    ): Promise<SourcePreparation> {
        if (source.kind === "zip")
        {
            return this.prepareZipSource(source, catalog, workspaceDirectory, reportProgress);
        }

        reportProgress(0.1, `Inspecting ${source.name}`, "Reading Unity AssetBundle", true);

        const inspection = await this.unityWorker.inspect(source.filePath);

        reportProgress(0.9, `Matching ${source.name}`, `${inspection.assets.length} assets found`);

        const result = this.assetBundleMatcher.match(inspection.assets, catalog);

        return {
            matches: result.matches.map((match) => ({
                character: match.character,
                assetNames: match.assets.map(({ outputName }) => outputName),
                extract: async (destination) => {
                    await this.unityWorker.extract(source.filePath, destination, match.assets)
                }
            })),
            incompleteMatches: result.incompleteMatches,
            hasAmbiguousMatches: result.hasAmbiguousMatches
        };
    }

    private async prepareZipSource(
        source: ModImportSource,
        catalog: CharacterCatalog,
        workspaceDirectory: string,
        reportProgress: SourceAnalysisProgressCallback
    ): Promise<SourcePreparation> {
        reportProgress(0.05, `Opening ${source.name}`, "Reading ZIP directory", true);

        const entries = await this.archive.inspect(source.filePath);

        reportProgress(0.15, `Matching ${source.name}`, `${entries.length} ZIP entries found`);

        const looseResult = this.zipMatcher.match(entries, catalog);

        const preparation: SourcePreparation = {
            matches: looseResult.matches.map((match) => ({
                character: match.character,
                assetNames: match.entries.map(({ outputName }) => outputName),
                extract: async (destination) => {
                    await this.archive.extractSelectedEntries(
                        source.filePath,
                        destination,
                        match.entries,
                        source.password
                    );
                }
            })),
            incompleteMatches: [...looseResult.incompleteMatches],
            hasAmbiguousMatches: looseResult.hasAmbiguousMatches
        };

        const embeddedBundles = await this.archive.extractEntriesMatchingSignature(
            source.filePath,
            workspaceDirectory,
            Buffer.from("UnityFS", "ascii"),
            source.password,
            {},
            (progress) => {
                const fraction = progress.totalEntries > 0
                    ? progress.completedEntries / progress.totalEntries
                    : 1;

                reportProgress(
                    0.2 + fraction * 0.5,
                    `Scanning ${source.name}`,
                    `${progress.completedEntries} of ${progress.totalEntries} entries checked`
                );
            }
        );

        for (let i = 0; i < embeddedBundles.length; i++)
        {
            const embeddedBundle = embeddedBundles[i];

            reportProgress(
                0.72 + i / Math.max(embeddedBundles.length, 1) * 0.26,
                `Inspecting embedded AssetBundle`,
                `${i + 1} of ${embeddedBundles.length} bundles`,
                true
            );

            const inspection = await this.unityWorker.inspect(embeddedBundle.filePath);
            const result = this.assetBundleMatcher.match(inspection.assets, catalog);

            preparation.matches.push(
                ...result.matches.map((match) => ({
                    character: match.character,
                    assetNames: match.assets.map(({ outputName }) => outputName),
                    extract: async (destination: string) => {
                        await this.unityWorker.extract(embeddedBundle.filePath, destination, match.assets)
                    }
                }))
            );

            preparation.incompleteMatches.push(...result.incompleteMatches);
            preparation.hasAmbiguousMatches ||= result.hasAmbiguousMatches;
        }

        return preparation;
    }

    private async reserveDestination(root: string, requestedName: string, reservedDirectories: Set<string>): Promise<string> {
        const baseName = requestedName.slice(0, 100);

        for (let i = 1; ; i++)
        {
            const suffix = i === 1 ? "" : `_${i}`;
            const candidateName = `${baseName.slice(0, 100 - suffix.length)}${suffix}`;

            const reservationKey = candidateName.toLowerCase();
            const candidatePath = path.join(root, candidateName);

            if (reservedDirectories.has(reservationKey))
                continue;
            if (await fse.exists(candidatePath))
                continue;

            reservedDirectories.add(reservationKey);
            return candidatePath;
        }
    }

    private createMatchingIssue(source: ModImportSource, preparation: SourcePreparation): ModImportIssue | null {
        if (preparation.incompleteMatches.length > 0)
        {
            return {
                sourceId: source.id,
                sourceName: source.name,
                kind: "incomplete",
                message: preparation.matches.length > 0
                    ? "The file also contains an incomplete Spine mod."
                    : "Required Spine assets are missing.",
                candidates: preparation.incompleteMatches.map((match) => ({
                    characterName: match.character.characterName,
                    skinName: match.character.skinName,
                    skin2dId: match.character.skin2dId,
                    foundAssets: match.foundAssets,
                    missingAssets: match.missingAssets
                }))
            };
        }

        if (preparation.matches.length > 0)
            return null;

        if (preparation.hasAmbiguousMatches)
        {
            return {
                sourceId: source.id,
                sourceName: source.name,
                kind: "ambiguous",
                message: "The file contains only shared asset names, so its character could not be identified safely.",
                candidates: []
            };
        }

        return {
            sourceId: source.id,
            sourceName: source.name,
            kind: "unrecognized",
            message: "No supported character assets from the catalog were found.",
            candidates: []
        };
    }

    private createExtractionIssue(source: ModImportSource, error: unknown): ModImportIssue {
        let message: string;

        if (source.kind === "zip" && error instanceof Error && error.message === "MISSING_PASSWORD")
        {
            message = "A password is required to open this ZIP file.";
        }
        else if (source.kind === "zip" && error instanceof Error && error.message === "BAD_PASSWORD")
        {
            message = "The password is incorrect or the ZIP encryption method is unsupported.";
        }
        else
        {
            const baseMessage = source.kind === "zip"
                ? "The archive could not be extracted."
                : "The AssetBundle could not be extracted.";

            message = ErrorUtils.combineWithCause(baseMessage, error, "The file may be damaged or use an unsupported format.");
        }

        return {
            sourceId: source.id,
            sourceName: source.name,
            kind: "extraction",
            message,
            candidates: []
        };
    }

    private createInspectionIssue(source: ModImportSource, error: unknown): ModImportIssue {
        if (source.kind === "zip" && error instanceof Error && ["MISSING_PASSWORD", "BAD_PASSWORD"].includes(error.message))
            return this.createExtractionIssue(source, error);

        const baseMessage = source.kind === "zip"
            ? "The archive could not be inspected."
            : "The AssetBundle could not be inspected.";

        return {
            sourceId: source.id,
            sourceName: source.name,
            kind: "invalid",
            message: ErrorUtils.combineWithCause(baseMessage, error, "The file may be damaged or use an unsupported format."),
            candidates: []
        };
    }
}
