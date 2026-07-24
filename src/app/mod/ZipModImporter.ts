import type { ExtractedModSummary, ModImportIssue, ZipExtractionResult } from "../../shared/mod.js";
import type { ZipModMatch, ZipMatchResult } from "./ZipModMatcher.js";

import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { ZipModMatcher } from "./ZipModMatcher.js";
import { ZipArchive } from "#utils/ZipArchive.js";
import { ErrorUtils } from "#utils/ErrorUtils.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

export type ZipImportSource = {
    id: string;
    name: string;
    filePath: string;
    password: string;
};

type AnalyzedSource = {
    source: ZipImportSource;
    matches: ZipModMatch[];
};

type SourceAnalysis = {
    sources: AnalyzedSource[];
    issues: ModImportIssue[];
};

type PlannedMod = {
    stagingDirectory: string;
    finalDirectory: string;
    summary: ExtractedModSummary;
};

export class ModImportError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "ModImportError";
    }
}

export class ZipModImporter {
    private readonly archive = new ZipArchive();
    private readonly matcher = new ZipModMatcher();

    async extract(sources: readonly ZipImportSource[], deleteOriginals: boolean): Promise<ZipExtractionResult> {
        if (sources.length === 0)
            throw new ModImportError("No ZIP archives were provided.");

        const analysis = await this.analyzeSources(sources);

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

        const modsRoot = Paths.getModsPath();
        const stagingRoot = path.join(modsRoot, `.staging-${randomUUID()}`);

        await fse.ensureDir(modsRoot);
        await fse.mkdir(stagingRoot);

        const reservedDirectories = new Set<string>();
        const plannedMods: PlannedMod[] = [];
        const movedDirectories: string[] = [];
        const extractionIssues: ModImportIssue[] = [];

        try
        {
            for (const analyzed of analyzedSources)
            {
                const archiveName = this.sanitizeDirectoryName(
                    path.basename(analyzed.source.name, path.extname(analyzed.source.name))
                );

                const containsMultipleMods = analyzed.matches.length > 1;
                const sourcePlans: PlannedMod[] = [];
                let sourceIssue: ModImportIssue | null = null;

                for (const match of analyzed.matches)
                {
                    const requestedName = containsMultipleMods
                        ? `${archiveName}-${this.sanitizeDirectoryName(match.character.characterName)}`
                        : archiveName;

                    const finalDirectory = await this.reserveDestination(modsRoot, requestedName, reservedDirectories);
                    const stagingDirectory = path.join(stagingRoot, randomUUID());

                    try
                    {
                        await this.archive.extractSelectedEntries(
                            analyzed.source.filePath,
                            stagingDirectory,
                            match.entries,
                            analyzed.source.password,
                            { maxTotalUncompressedBytes: 1 * 1024 ** 3 }
                        );
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
                            assetCount: match.entries.length
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
        finally
        {
            await fse.rm(stagingRoot, { recursive: true, force: true });
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
                    console.error(`Could not delete imported ZIP ${source.filePath}:`, error);

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

    private async analyzeSources(sources: readonly ZipImportSource[]): Promise<SourceAnalysis> {
        const catalog = await characterCatalog.getCatalog();
        const analyzedSources: AnalyzedSource[] = [];
        const issues: ModImportIssue[] = [];

        for (const source of sources)
        {
            let result: ZipMatchResult;

            try
            {
                const entries = await this.archive.inspect(source.filePath);
                result = this.matcher.match(entries, catalog);
            }
            catch (error)
            {
                console.error(`Could not inspect ${source.filePath}:`, error);

                issues.push({
                    sourceId: source.id,
                    sourceName: source.name,
                    kind: "invalid",
                    message: "The archive could not be inspected. It may be invalid or corrupted.",
                    candidates: []
                });

                continue;
            }

            if (result.incompleteMatches.length > 0)
            {
                issues.push({
                    sourceId: source.id,
                    sourceName: source.name,
                    kind: "incomplete",
                    message: result.matches.length > 0
                        ? "The archive also contains an incomplete Spine mod."
                        : "Required Spine assets are missing.",
                    candidates: result.incompleteMatches.map((match) => ({
                        characterName: match.character.characterName,
                        skinName: match.character.skinName,
                        skin2dId: match.character.skin2dId,
                        foundAssets: match.foundAssets,
                        missingAssets: match.missingAssets
                    }))
                });

                continue;
            }

            if (result.matches.length === 0)
            {
                if (result.hasAmbiguousMatches)
                {
                    issues.push({
                        sourceId: source.id,
                        sourceName: source.name,
                        kind: "ambiguous",
                        message: "The archive contains only shared asset names, so its character could not be identified safely.",
                        candidates: []
                    });
                }
                else
                {
                    issues.push({
                        sourceId: source.id,
                        sourceName: source.name,
                        kind: "unrecognized",
                        message: "No supported character assets from the catalog were found.",
                        candidates: []
                    });
                }

                continue;
            }

            analyzedSources.push({
                source,
                matches: result.matches
            });
        }

        return {
            sources: analyzedSources,
            issues
        };
    }

    private async reserveDestination(root: string, requestedName: string, reservedDirectories: Set<string>) {
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

    private sanitizeDirectoryName(value: string) {
        let sanitized = value
            .normalize("NFKC")
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
            .replace(/[. ]+$/g, "")
            .trim()

        if (!sanitized)
            sanitized = "mod";

        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized))
            sanitized = `_${sanitized}`;

        return sanitized.slice(0, 80);
    }

    private createExtractionIssue(source: ZipImportSource, error: unknown): ModImportIssue {
        let message = "The archive could not be extracted.";

        if (error instanceof Error)
        {
            if (error.message === "MISSING_PASSWORD")
                message = "A password is required to open this ZIP file.";
            else if (error.message === "BAD_PASSWORD")
                message = "The password is incorrect or the ZIP encryption is unsupported.";
            else
                message = "Make sure the archive is valid.";
        }

        return {
            sourceId: source.id,
            sourceName: source.name,
            kind: "extraction",
            message,
            candidates: []
        };
    }
}
