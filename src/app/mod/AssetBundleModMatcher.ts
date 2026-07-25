import type { UnityAssetSelection, UnityBundleAsset } from "./UnityWorkerClient.js";
import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";

import { StringUtils } from "#utils/StringUtils.js";
import { ModMatcher } from "./ModMatcher.js";

export type AssetBundleModMatch = {
    character: CharacterSkin;
    assets: UnityAssetSelection[];
};

export type IncompleteAssetBundleModMatch = {
    character: CharacterSkin;
    foundAssets: string[];
    missingAssets: string[];
};

export type AssetBundleMatchResult = {
    matches: AssetBundleModMatch[];
    incompleteMatches: IncompleteAssetBundleModMatch[];
    hasAmbiguousMatches: boolean;
};

type AssetBundleMatchContext = ReadonlyMap<string, readonly UnityBundleAsset[]>;

export class AssetBundleModMatcher extends ModMatcher {
    match(assets: readonly UnityBundleAsset[], catalog: CharacterCatalog): AssetBundleMatchResult {
        const indexedAssets = this.indexAssets(assets);

        return this.matchCandidates<AssetBundleMatchContext, UnityAssetSelection, AssetBundleModMatch, IncompleteAssetBundleModMatch>({
            catalog,
            contexts: [indexedAssets],
            select: (context, character) => this.selectAssets(character, context),
            contextIdentity: () => "asset-bundle",
            selectionIdentity: ({ id, outputName }) => [
                id,
                StringUtils.normalize(outputName)
            ].join("\0"),
            createMatch: (character, selections) => ({
                character,
                assets: selections
            }),
            createIncompleteMatch: (character, foundAssets, missingAssets) => ({
                character,
                foundAssets,
                missingAssets
            })
        });
    }

    private indexAssets(assets: readonly UnityBundleAsset[]) {
        const indexed = new Map<string, UnityBundleAsset[]>();

        for (const asset of assets)
        {
            const candidateNames = new Set(asset.catalogCandidates.map((candidate) => StringUtils.normalize(candidate)));

            for (const candidateName of candidateNames)
            {
                const candidates = indexed.get(candidateName) ?? [];

                candidates.push(asset);
                indexed.set(candidateName, candidates);
            }
        }

        return indexed;
    }

    private selectAssets(character: CharacterSkin, indexedAssets: ReadonlyMap<string, readonly UnityBundleAsset[]>): UnityAssetSelection[] {
        const candidatesList = character.assets.map((outputName) => {
            const normalizedOutputName = StringUtils.normalize(outputName);
            const candidates = indexedAssets.get(normalizedOutputName) ?? [];

            const uniqueCandidates = new Map(candidates.map((candidate) => [candidate.id, candidate]));

            return [...uniqueCandidates.values()].sort((left, right) => {
                const leftIsExact = StringUtils.normalize(left.name) === normalizedOutputName;
                const rightIsExact = StringUtils.normalize(right.name) === normalizedOutputName;

                if (leftIsExact !== rightIsExact)
                    return leftIsExact ? -1 : 1;

                return left.id.localeCompare(right.id);
            });
        });

        const assetOwners = new Map<string, number>();
        const assignments = new Map<number, UnityBundleAsset>();

        const assignAsset = (catalogAssetIndex: number, visitedAssetIds: Set<string>) => {
            for (const candidate of candidatesList[catalogAssetIndex])
            {
                if (visitedAssetIds.has(candidate.id))
                    continue;

                visitedAssetIds.add(candidate.id);

                const currentOwner = assetOwners.get(candidate.id);
                if (currentOwner === undefined || assignAsset(currentOwner, visitedAssetIds))
                {
                    assetOwners.set(candidate.id, catalogAssetIndex);
                    assignments.set(catalogAssetIndex, candidate);
                    return true;
                }
            }

            return false;
        };

        const assignmentOrder = character.assets
            .map((_, index) => index)
            .sort((left, right) => {
                const candidateDifference = candidatesList[left].length - candidatesList[right].length;
                return candidateDifference || left - right;
            });

        for (const catalogAssetIndex of assignmentOrder)
            assignAsset(catalogAssetIndex, new Set());

        const selections: UnityAssetSelection[] = [];

        for (let i = 0; i < character.assets.length; i++)
        {
            const assignedAsset = assignments.get(i);
            if (!assignedAsset)
                continue;

            selections.push({
                id: assignedAsset.id,
                outputName: character.assets[i]
            });
        }

        return selections;
    }
}
