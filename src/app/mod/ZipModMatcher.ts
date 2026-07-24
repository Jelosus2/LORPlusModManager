import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";
import type { ZipEntryInfo, ZipEntrySelection } from "#utils/ZipArchive.js";

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

export class ZipModMatcher {
    match(entries: readonly ZipEntryInfo[], catalog: CharacterCatalog): ZipMatchResult {
        const ownership = this.buildAssetOwnerShip(catalog);
        const directories = this.groupEntriesByDirectory(entries);

        const matches: ZipModMatch[] = [];
        const matchKeys = new Set<string>();

        const incompleteMatches: IncompleteZipModMatch[] = [];
        const incompleteMatchKeys = new Set<string>();

        let hasAmbiguousMatches = false;

        for (const [directory, files] of directories)
        {
            for (const character of catalog.characters)
            {
                const selectedEntries: ZipEntrySelection[] = [];
                let hasDuplicatedEntry = false;

                for (const asset of character.assets)
                {
                    const candidates = files.get(this.normalize(asset)) ?? [];
                    if (candidates.length > 1)
                    {
                        hasDuplicatedEntry = true;
                        break;
                    }

                    const entry = candidates[0];
                    if (entry)
                    {
                        selectedEntries.push({
                            entryPath: entry.path,
                            outputName: asset
                        });
                    }
                }

                if (hasDuplicatedEntry)
                    continue;

                const hasUniqueEvidence = selectedEntries.some(({ outputName }) => {
                    const owners = ownership.get(this.normalize(outputName));
                    return owners?.size === 1;
                });

                if (character.isSpineSkin)
                {
                    if (selectedEntries.length !== character.assets.length)
                    {
                        if (selectedEntries.length > 0 && hasUniqueEvidence)
                        {
                            const incompleteKey = [
                                directory,
                                this.characterIdentity(character)
                            ].join("\0");

                            if (!incompleteMatchKeys.has(incompleteKey))
                            {
                                incompleteMatchKeys.add(incompleteKey);

                                const foundAssetNames = new Set(
                                    selectedEntries.map(({ outputName }) => this.normalize(outputName))
                                );

                                incompleteMatches.push({
                                    character,
                                    foundAssets: selectedEntries.map(({ outputName }) => outputName),
                                    missingAssets: character.assets.filter((asset) => !foundAssetNames.has(this.normalize(asset)))
                                });
                            }
                        }

                        continue;
                    }
                }
                else
                {
                    const isSupportedAppearance =
                        character.isAnimatorSkin ||
                        character.isStaticSkin;

                    if (!isSupportedAppearance || selectedEntries.length === 0)
                        continue;

                    if (!hasUniqueEvidence)
                    {
                        hasAmbiguousMatches = true;
                        continue;
                    }
                }

                const matchKey = [
                    directory,
                    this.characterIdentity(character),
                    ...selectedEntries.map(({ entryPath }) => entryPath.toLowerCase()).sort()
                ].join("\0");

                if (matchKeys.has(matchKey))
                    continue;

                matchKeys.add(matchKey);

                matches.push({
                    character,
                    entries: selectedEntries
                });
            }
        }

        incompleteMatches.sort((left, right) => left.missingAssets.length - right.missingAssets.length);

        return {
            matches,
            incompleteMatches,
            hasAmbiguousMatches
        };
    }

    private buildAssetOwnerShip(catalog: CharacterCatalog) {
        const ownership = new Map<string, Set<string>>();

        for (const character of catalog.characters)
        {
            const identity = this.characterIdentity(character);

            for (const asset of character.assets)
            {
                const key = this.normalize(asset);
                const owners = ownership.get(key) ?? new Set<string>();

                owners.add(identity);
                ownership.set(key, owners);
            }
        }

        return ownership;
    }

    private groupEntriesByDirectory(entries: readonly ZipEntryInfo[]) {
        const directories = new Map<string, Map<string, ZipEntryInfo[]>>();

        for (const entry of entries)
        {
            if (entry.type != "File")
                continue;

            const directory = path.posix.dirname(entry.path).toLowerCase();
            const fileName = this.normalize(path.posix.basename(entry.path));

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

    private characterIdentity(skin: CharacterSkin) {
        return [
            skin.skin2dId,
            ...skin.assets.map((asset) => this.normalize(asset)).sort()
        ].join("\0");
    }

    private normalize(value: string) {
        return value.trim().toLowerCase();
    }
}
