import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";

import { StringUtils } from "#utils/StringUtils.js";

type CatalogAssetSelection = {
    outputName: string;
};

type MatchOptions<
    TContext,
    TSelection extends CatalogAssetSelection,
    TMatch,
    TIncompleteMatch
> = {
    catalog: CharacterCatalog;
    contexts: readonly TContext[];

    select: (
        context: TContext,
        character: CharacterSkin
    ) => readonly TSelection[] | null;

    contextIdentity: (context: TContext) => string;
    selectionIdentity: (selection: TSelection) => string;

    createMatch: (
        character: CharacterSkin,
        selections: TSelection[]
    ) => TMatch;

    createIncompleteMatch: (
        character: CharacterSkin,
        foundAssets: string[],
        missingAssets: string[]
    ) => TIncompleteMatch;
};

export class ModMatcher {
    protected matchCandidates<TContext, TSelection extends CatalogAssetSelection, TMatch, TIncompleteMatch>(
        options: MatchOptions<TContext, TSelection, TMatch, TIncompleteMatch>
    ) {
        const ownership = this.buildAssetOwnerShip(options.catalog);

        const matches: TMatch[] = [];
        const matchKeys = new Set<string>();

        const incompleteMatches: {
            match: TIncompleteMatch;
            missingAssetCount: number;
        }[] = [];
        const incompleteMatchKeys = new Set<string>();

        let hasAmbiguousMatches = false;

        for (const context of options.contexts)
        {
            const contextIdentity = options.contextIdentity(context);

            for (const character of options.catalog.characters)
            {
                const selected = options.select(context, character);
                if (selected === null)
                    continue;

                const selections = [...selected];
                const selectedNames = new Set(selections.map(({ outputName }) => StringUtils.normalize(outputName)));

                const hasUniqueEvidence = selections.some(({ outputName }) => {
                    const owners = ownership.get(StringUtils.normalize(outputName));
                    return owners?.size === 1;
                });

                if (character.isSpineSkin)
                {
                    if (selections.length !== character.assets.length)
                    {
                        if (selections.length > 0 && hasUniqueEvidence)
                        {
                            const incompleteKey = [
                                contextIdentity,
                                this.characterIdentity(character)
                            ].join("\0");

                            if (!incompleteMatchKeys.has(incompleteKey))
                            {
                                incompleteMatchKeys.add(incompleteKey);

                                const foundAssets = selections.map(({ outputName }) => outputName);
                                const missingAssets = character.assets.filter((asset) => !selectedNames.has(StringUtils.normalize(asset)));

                                incompleteMatches.push({
                                    match: options.createIncompleteMatch(character, foundAssets, missingAssets),
                                    missingAssetCount: missingAssets.length
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

                    if (!isSupportedAppearance || selections.length === 0)
                        continue;

                    if (!hasUniqueEvidence)
                    {
                        hasAmbiguousMatches = true;
                        continue;
                    }
                }

                const matchKey = [
                    contextIdentity,
                    this.characterIdentity(character),
                    ...selections.map(options.selectionIdentity).sort()
                ].join("\0");

                if (matchKeys.has(matchKey))
                    continue;

                matchKeys.add(matchKey);
                matches.push(options.createMatch(character, selections));
            }
        }

        incompleteMatches.sort((left, right) => left.missingAssetCount - right.missingAssetCount);

        return {
            matches,
            incompleteMatches: incompleteMatches.map(({ match }) => match),
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
                const key = StringUtils.normalize(asset);
                const owners = ownership.get(key) ?? new Set<string>();

                owners.add(identity);
                ownership.set(key, owners);
            }
        }

        return ownership;
    }

    private characterIdentity(character: CharacterSkin) {
        return [
            StringUtils.normalize(character.skin2dId),
            character.variantId
                ? StringUtils.normalize(character.variantId)
                : ""
        ].join("\0");
    }
}
