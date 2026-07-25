import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";
import type { ZipEntryInfo, ZipEntrySelection } from "#utils/ZipArchive.js";

import { StringUtils } from "#utils/StringUtils.js";
import { ModMatcher } from "./ModMatcher.js";
import path from "node:path";

export type ZipModMatch = {
    character: CharacterSkin;
    entries: ZipEntrySelection[];
};

export type IncompleteZipModMatch = {
    character: CharacterSkin;
    foundAssets: string[];
    missingAssets: string[];
};

export type ZipMatchResult = {
    matches: ZipModMatch[];
    incompleteMatches: IncompleteZipModMatch[];
    hasAmbiguousMatches: boolean;
};

type ZipMatchContext = {
    directory: string;
    files: ReadonlyMap<string, readonly ZipEntryInfo[]>;
};

export class ZipModMatcher extends ModMatcher {
    match(entries: readonly ZipEntryInfo[], catalog: CharacterCatalog): ZipMatchResult {
        const contexts: ZipMatchContext[] = [...this.groupEntriesByDirectory(entries)].map(([directory, files]) => ({
            directory,
            files
        }));

        return this.matchCandidates<ZipMatchContext, ZipEntrySelection, ZipModMatch, IncompleteZipModMatch>({
            catalog,
            contexts,
            select: (context, character) => this.selectEntries(character, context.files),
            contextIdentity: ({ directory }) => directory,
            selectionIdentity: ({ entryPath, outputName }) => [
                StringUtils.normalize(entryPath),
                StringUtils.normalize(outputName)
            ].join("\0"),
            createMatch: (character, selections) => ({
                character,
                entries: selections
            }),
            createIncompleteMatch: (character, foundAssets, missingAssets) => ({
                character,
                foundAssets,
                missingAssets
            })
        });
    }

    private selectEntries(character: CharacterSkin, files: ReadonlyMap<string, readonly ZipEntryInfo[]>): ZipEntrySelection[] | null {
        const selections: ZipEntrySelection[] = [];

        for (const outputName of character.assets)
        {
            const candidates = files.get(StringUtils.normalize(outputName)) ?? [];
            if (candidates.length > 1)
                return null;

            const entry = candidates[0];
            if (entry)
            {
                selections.push({
                    entryPath: entry.path,
                    outputName
                });
            }
        }

        return selections;
    }

    private groupEntriesByDirectory(entries: readonly ZipEntryInfo[]) {
        const directories = new Map<string, Map<string, ZipEntryInfo[]>>();

        for (const entry of entries)
        {
            if (entry.type != "File")
                continue;

            const directory = path.posix.dirname(entry.path).toLowerCase();
            const fileName = StringUtils.normalize(path.posix.basename(entry.path));

            let directoryFiles = directories.get(directory);
            if (!directoryFiles)
            {
                directoryFiles = new Map<string, ZipEntryInfo[]>();
                directories.set(directory, directoryFiles);
            }

            const candidates = directoryFiles.get(fileName) ?? [];
            candidates.push(entry);

            directoryFiles.set(fileName, candidates);
        }

        return directories;
    }
}
