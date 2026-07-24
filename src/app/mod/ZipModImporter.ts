import type { ExtractedModSummary, ZipExtractionResult } from "../../shared/mod.js";
import type { ZipModMatch } from "./ZipModMatcher.js";

import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { ZipModMatcher } from "./ZipModMatcher.js";
import { ZipArchive } from "#utils/ZipArchive.js";
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

        const analyzedSources = await this.analyzeSources(sources);
        const modsRoot = Paths.getModsPath();
        const stagingRoot = path.join(modsRoot, `.staging-${randomUUID()}`);

        await fse.ensureDir(modsRoot);
        await fse.mkdir(stagingRoot);

        const reservedDirectories = new Set<string>();
        const plannedMods: PlannedMod[] = [];
        const movedDirectories: string[] = [];

        try
        {
            for (const analyzed of analyzedSources)
            {
                const archiveName = this.sanitizeDirectoryName(
                    path.basename(analyzed.source.name, path.extname(analyzed.source.name))
                );

                const containsMultipleMods = analyzed.matches.length > 1;

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
                        throw new ModImportError(
                            `Could not extract ${analyzed.source.name}. ` +
                            "Check its password and make sure the archive is valid.",
                            { cause: error }
                        );
                    }

                    plannedMods.push({
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
                    warnings.push(`${source.name} could not be deleted.`);
                }
            }
        }

        const mods = plannedMods.map(({ summary }) => summary);

        return {
            success: true,
            message: `${mods.length} ${mods.length === 1 ? "mod" : "mods"} imported successfully.`,
            mods,
            warnings
        };
    }

    private async analyzeSources(sources: readonly ZipImportSource[]): Promise<AnalyzedSource[]> {
        const catalog = await characterCatalog.getCatalog();
        const analyzedSources: AnalyzedSource[] = [];

        for (const source of sources)
        {
            let entries;

            try
            {
                entries = await this.archive.inspect(source.filePath);
            }
            catch (error)
            {
                throw new ModImportError(`${source.name} could not be inspected.`, { cause: error });
            }

            const result = this.matcher.match(entries, catalog);

            if (result.matches.length === 0)
            {
                if (result.incompleteMatches.length > 0)
                {
                    const displayedMatches = result.incompleteMatches
                        .slice(0, 3)
                        .map(({ character, missingAssets }) =>
                            `${character.characterName}: ${character.skinName} is missing ${missingAssets.join(", ")}`
                        );

                    const remainingCount = result.incompleteMatches.length - displayedMatches.length;

                    const remainingMessage = remainingCount > 0
                        ? `; and ${remainingCount} other possible match${remainingCount === 1 ? "" : "es"}`
                        : "";

                    throw new ModImportError(`${source.name} contains an incomplete mod: ${displayedMatches.join("; ")}${remainingMessage}`);
                }

                if (result.hasAmbiguousMatches)
                    throw new ModImportError(`${source.name} contains only shared asset names, so its character could not be identified safely.`);

                throw new ModImportError(`${source.name} does not contain a recognized mod.`);
            }

            analyzedSources.push({
                source,
                matches: result.matches
            });
        }

        return analyzedSources;
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
}
