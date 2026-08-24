import type { PreparedStaticPreviewAsset, StaticCharacterSkin, StaticModPreviewPreparation } from "../../shared/characters.js";
import type { UnityPreviewAssetRequest } from "./UnityPreviewAssetCacheService.js";

import { unityPreviewAssetCache } from "./UnityPreviewAssetCacheService.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { StringUtils } from "#utils/StringUtils.js";
import { ModVerifier } from "./ModVerifier.js";

export class StaticModPreviewService {
    private readonly modRepository = new ModRepository();
    private readonly modVerifier = new ModVerifier();

    async prepare(modId: string): Promise<StaticModPreviewPreparation> {
        const mod = this.modRepository.getById(modId);
        if (!mod)
            throw new UserFacingError("The selected mod no longer exists.");

        const verifiedMod = await this.modVerifier.verify(mod);
        if (verifiedMod.verification.status !== "valid")
            throw new UserFacingError(verifiedMod.verification.message || "The selected mod is not currently valid.");

        const skin = await this.findStaticSkin(mod.skin2dId, mod.variantId);
        const modAssetNames = new Set(mod.assetNames.map(StringUtils.normalize));
        const prepared = new Map<string, PreparedStaticPreviewAsset>();
        const gameRequests = new Map<string, Map<string, UnityPreviewAssetRequest>>();

        const addGameRequest = (bundleName: string, request: UnityPreviewAssetRequest) => {
            let bundleRequests = gameRequests.get(bundleName);

            if (!bundleRequests)
            {
                bundleRequests = new Map();
                gameRequests.set(bundleName, bundleRequests);
            }

            bundleRequests.set(this.getAssetIdentity(request.type, bundleName, request.name), Object.freeze(request));
        };

        const layers = [
            ...skin.staticPreview.layers,
            ...skin.staticPreview.mosaicMasks
        ];

        for (const layer of layers)
        {
            for (const source of [layer.sources.unedited, layer.sources.rplus])
            {
                if (!source)
                    continue;
                if (source.generated === "white")
                    continue;

                const assetName = source.asset;
                if (!assetName)
                    throw new Error("A static preview texture source has no asset.");

                const identity = this.getAssetIdentity("Texture2D", skin.staticPreview.assetBundleName, assetName);

                if (modAssetNames.has(StringUtils.normalize(assetName)))
                {
                    prepared.set(identity, Object.freeze({
                        type: "Texture2D",
                        name: assetName,
                        bundleName: skin.staticPreview.assetBundleName,
                        source: "mod",
                        cacheKey: null,
                        versionHash: null,
                        sprite: null
                    }));

                    continue;
                }

                addGameRequest(skin.staticPreview.assetBundleName, { type: "Texture2D", name: assetName });
            }
        }

        for (const expression of skin.staticPreview.face?.expressions ?? [])
            addGameRequest(expression.bundleName, { type: "Sprite", name: expression.assetName });

        await Promise.all([...gameRequests.entries()].map(async ([bundleName, requestsByIdentity]) => {
            const assets = await unityPreviewAssetCache.ensureBundleAssets(bundleName, [...requestsByIdentity.values()]);

            for (const asset of assets)
            {
                const identity = this.getAssetIdentity(asset.type, asset.bundleName, asset.name);

                prepared.set(identity, Object.freeze({
                    type: asset.type,
                    name: asset.name,
                    bundleName: asset.bundleName,
                    source: "game",
                    cacheKey: asset.key,
                    versionHash: asset.versionHash,
                    sprite: asset.sprite
                        ? Object.freeze({
                            pixelWidth: asset.sprite.pixelWidth,
                            pixelHeight: asset.sprite.pixelHeight,
                            pixelsPerUnit: asset.sprite.pixelsPerUnit,
                            pivot: Object.freeze({
                                x: asset.sprite.pivot.x,
                                y: asset.sprite.pivot.y
                            })
                        })
                        : null
                }));
            }
        }));

        const assets = [...prepared.values()].sort((left, right) => {
            return (
                left.type.localeCompare(right.type, "en-US") ||
                left.bundleName.localeCompare(right.bundleName, "en-US") ||
                left.name.localeCompare(right.name, "en-US")
            );
        });

        return Object.freeze({
            modId: mod.id,
            skin2dId: skin.skin2dId,
            variantId: skin.variantId,
            assets: Object.freeze(assets)
        });
    }

    private async findStaticSkin(skin2dId: string, variantId: string | null): Promise<StaticCharacterSkin> {
        const skin = await characterCatalog.findSkin(skin2dId, variantId);

        if (!skin)
            throw new UserFacingError("The mod's character skin is no longer present in the catalog.");
        if (!skin.isStaticSkin)
            throw new UserFacingError("The selected mod is not a static-skin mod.");

        return skin;
    }

    private getAssetIdentity(type: "Texture2D" | "Sprite", bundleName: string, assetName: string): string {
        return JSON.stringify([
            type,
            StringUtils.normalize(bundleName),
            StringUtils.normalize(assetName)
        ]);
    }
}

export const staticModPreviewService = new StaticModPreviewService();
