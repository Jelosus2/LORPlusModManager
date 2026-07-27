import type { ExtractedModSummary, ModExtractionResult, ModImportIssue, ModSourceKind } from "../../shared/mod.js";
import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";
import type { ImportedModRecord } from "#database/repositories/ModRepository.js";

import { UnityWorkerClient, UnityWorkerError } from "./UnityWorkerClient.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { AssetBundleModMatcher } from "./AssetBundleModMatcher.js";
import { ZipModMatcher } from "./ZipModMatcher.js";
import { ZipArchive } from "#utils/ZipArchive.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
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

export class ModImportError extends Error {
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

    async extract(sources: readonly ModImportSource[], deleteOriginals: boolean): Promise<ModExtractionResult> {
        if (sources.length === 0)
            throw new ModImportError("No mod files were provided.");

        const modsRoot = Paths.getModsPath();
        const stagingRoot = path.join(modsRoot, `.staging-${randomUUID()}`);

        await fse.ensureDir(modsRoot);
        await fse.mkdir(stagingRoot);

        try
        {
            return await this.extractInWorkspace(sources, deleteOriginals, modsRoot, stagingRoot);
        }
        finally
        {
            await fse.rm(stagingRoot, { recursive: true, force: true });
        }
    }

    private async extractInWorkspace(
        sources: readonly ModImportSource[],
        deleteOriginals: boolean,
        modsRoot: string,
        stagingRoot: string
    ): Promise<ModExtractionResult> {
        const analysis = await this.analyzeSources(sources, path.join(stagingRoot, "sources"));

        if (analysis.issues.length > 0)
        {
            return {
                success: false,
                message:
                    `${analysis.issues.length} ` +
                    `${analysis.issues.length === 1 ? "file needs" : "files need"} attention. ` +
                    "No files were extracted or deleted.",
                mods: [],
                warnings: [],
                issues: analysis.issues
            };
        }

        const analyzedSources = analysis.sources;

        const reservedDirectories = new Set<string>();
        const plannedMods: PlannedMod[] = [];
        const movedDirectories: string[] = [];
        const extractionIssues: ModImportIssue[] = [];

        try
        {
            for (const analyzed of analyzedSources)
            {
                const fallbackName = path.basename(analyzed.source.name, path.extname(analyzed.source.name));
                const sourceDirectoryName = analyzed.source.directoryName.trim() || fallbackName;
                const directoryName = Paths.sanitizeDirectoryName(sourceDirectoryName, "mod", 80);

                const containsMultipleMods = analyzed.matches.length > 1;
                const sourcePlans: PlannedMod[] = [];
                let sourceIssue: ModImportIssue | null = null;

                for (const match of analyzed.matches)
                {
                    const requestedName = containsMultipleMods
                        ? `${directoryName}-${Paths.sanitizeDirectoryName(match.character.characterName, "mod", 80)}`
                        : directoryName;

                    const finalDirectory = await this.reserveDestination(modsRoot, requestedName, reservedDirectories);
                    const stagingDirectory = path.join(stagingRoot, "mods", randomUUID());

                    try
                    {
                        await match.extract(stagingDirectory);
                    }
                    catch (error)
                    {
                        sourceIssue = this.createExtractionIssue(analyzed.source, error);
                        break;
                    }

                    sourcePlans.push({
                        stagingDirectory,
                        finalDirectory,
                        summary: {
                            sourceName: analyzed.source.name,
                            characterName: match.character.characterName,
                            skinName: match.character.skinName,
                            skin2dId: match.character.skin2dId,
                            variantId: match.character.variantId,
                            assetCount: match.assetNames.length
                        },
                        record: {
                            id: randomUUID(),
                            directoryName: path.basename(finalDirectory),
                            sourceName: analyzed.source.name,
                            sourceKind: analyzed.source.kind,
                            skin2dId: match.character.skin2dId,
                            variantId: match.character.variantId,
                            assetNames: [...match.assetNames]
                        }
                    });
                }

                if (sourceIssue)
                    extractionIssues.push(sourceIssue);
                else
                    plannedMods.push(...sourcePlans);
            }

            if (extractionIssues.length > 0)
            {
                return {
                    success: false,
                    message:
                        `${extractionIssues.length} ` +
                        `${extractionIssues.length === 1 ? "file needs" : "files need"} attention. ` +
                        "No files were extracted or deleted.",
                    mods: [],
                    warnings: [],
                    issues: extractionIssues
                };
            }

            for (const plannedMod of plannedMods)
            {
                await fse.move(plannedMod.stagingDirectory, plannedMod.finalDirectory);
                movedDirectories.push(plannedMod.finalDirectory);
            }

            this.modRepository.addImportedMods(plannedMods.map(({ record }) => record));
        }
        catch (error)
        {
            await Promise.allSettled(
                movedDirectories.map((directory) => fse.rm(directory, { recursive: true, force: true }))
            );

            if (error instanceof ModImportError)
                throw error;

            throw new ModImportError("The extracted mods could not be committed.", { cause: error });
        }

        const warnings: string[] = [];

        if (deleteOriginals)
        {
            for (const source of sources)
            {
                try
                {
                    await fse.unlink(source.filePath);
                }
                catch (error)
                {
                    console.error(`Could not delete imported mod ${source.filePath}:`, error);

                    let message = `${source.name} could not be deleted. `;
                    message += ErrorUtils.getFsErrorMessage(error);

                    warnings.push(message.trim());
                }
            }
        }

        const mods = plannedMods.map(({ summary }) => summary);

        return {
            success: true,
            message: `${mods.length} ${mods.length === 1 ? "mod" : "mods"} imported successfully.`,
            mods,
            warnings,
            issues: []
        };
    }

    private async analyzeSources(sources: readonly ModImportSource[], workspaceRoot: string): Promise<{
        sources: PreparedSource[];
        issues: ModImportIssue[];
    }> {
        const catalog = await characterCatalog.getCatalog();
        const analyzedSources: PreparedSource[] = [];
        const issues: ModImportIssue[] = [];

        for (const source of sources)
        {
            let preparation: SourcePreparation;

            try
            {
                preparation = await this.prepareSource(source, catalog, path.join(workspaceRoot, randomUUID()));
            }
            catch (error)
            {
                console.error(`Could not inspect ${source.filePath}:`, error);

                issues.push(this.createInspectionIssue(source, error));
                continue;
            }

            const matchingIssue = this.createMatchingIssue(source, preparation);
            if (matchingIssue)
            {
                issues.push(matchingIssue);
                continue;
            }

            analyzedSources.push({
                source,
                matches: preparation.matches
            });
        }

        return {
            sources: analyzedSources,
            issues
        };
    }

    private async prepareSource(source: ModImportSource, catalog: CharacterCatalog, workspaceDirectory: string): Promise<SourcePreparation> {
        if (source.kind === "zip")
        {
            return this.prepareZipSource(source, catalog, workspaceDirectory);
        }

        const inspection = await this.unityWorker.inspect(source.filePath);
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

    private async prepareZipSource(source: ModImportSource, catalog: CharacterCatalog, workspaceDirectory: string): Promise<SourcePreparation> {
        const entries = await this.archive.inspect(source.filePath);
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
                        source.password,
                        { maxTotalUncompressedBytes: 1024 ** 3 }
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
            source.password
        );

        for (const embeddedBundle of embeddedBundles)
        {
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

        if (source.kind === "zip")
        {
            message = "The archive could not be extracted.";

            if (error instanceof Error)
            {
                if (error.message === "MISSING_PASSWORD")
                    message = "A password is required to open this ZIP file.";
                else if (error.message === "BAD_PASSWORD")
                    message = "The password is incorrect or the ZIP encryption is unsupported.";
                else
                    message = "Make sure the archive is valid.";
            }
        }
        else
        {
            message = "The AssetBundle could not be extracted.";

            if (error instanceof UnityWorkerError)
                message += ` ${error.message}`;
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

        let message = source.kind === "zip"
            ? "The archive could not be inspected. It may be invalid or corrupted."
            : "The AssetBundle could not be inspected. It may be invalid or corrupted.";

        if (source.kind === "asset-bundle" && error instanceof UnityWorkerError && error.message === "The Unity worker could not be started.")
            message = "The AssetBundle extractor could not be started.";

        return {
            sourceId: source.id,
            sourceName: source.name,
            kind: "invalid",
            message,
            candidates: []
        };
    }
}
