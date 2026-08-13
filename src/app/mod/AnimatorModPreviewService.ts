import type { AnimatorCharacterSkin, AnimatorModPreviewPreparation, PreparedPreviewAsset, PreviewFaceExpression } from "../../shared/characters.js";

import { unityPreviewAssetCache, type CachedAnimatorRuntimePackage } from "./UnityPreviewAssetCacheService.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { StringUtils } from "#utils/StringUtils.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { ModVerifier } from "./ModVerifier.js";
import path from "node:path";
import fse from "fs-extra";

export class AnimatorModPreviewService {
    private readonly modRepository = new ModRepository();
    private readonly modVerifier = new ModVerifier();

    async prepare(modId: string): Promise<AnimatorModPreviewPreparation> {
        const mod = this.modRepository.getById(modId);
        if (!mod)
            throw new UserFacingError("The selected mod no longer exists.");

        const verifiedMod = await this.modVerifier.verify(mod);
        if (verifiedMod.verification.status !== "valid")
            throw new UserFacingError(verifiedMod.verification.message || "The selected mod is not currently valid.");

        const skin = await this.findAnimatorSkin(mod.skin2dId, mod.variantId);
        const bundleName = StringUtils.normalize(skin.skin2dId);
        const runtime = await unityPreviewAssetCache.ensureAnimatorRuntime(bundleName, skin.skin2dId);
        const faces = await this.prepareFaceAssets(runtime, skin.animatorPreview.faces);

        return Object.freeze({
            modId: mod.id,
            skin2dId: skin.skin2dId,
            variantId: skin.variantId,
            runtime: Object.freeze({
                bundleName: runtime.bundleName,
                versionHash: runtime.versionHash,
                cacheKey: runtime.key,
                formatVersion: runtime.formatVersion
            }),
            faces
        });
    }

    private async prepareFaceAssets(runtime: CachedAnimatorRuntimePackage, catalogFaces: readonly PreviewFaceExpression[]): Promise<readonly PreparedPreviewAsset[]> {
        const runtimeFaceNames = await this.readRuntimeFaceNames(runtime);
        const requestsByBundle = new Map<string, Set<string>>();

        const addRequest = (bundleName: string, assetName: string) => {
            const requests = requestsByBundle.get(bundleName) ?? new Set<string>();
            requests.add(assetName);
            requestsByBundle.set(bundleName, requests);
        };

        for (const face of catalogFaces)
            addRequest(face.bundleName, face.assetName);

        for (const faceName of runtimeFaceNames)
            addRequest(this.getFaceBundleName(faceName), faceName);

        const prepared = await Promise.all(
            [...requestsByBundle.entries()].map(async ([bundleName, faceNames]) => {
                try
                {
                    const assets = await unityPreviewAssetCache.ensureBundleAssets(
                        bundleName,
                        [...faceNames].map((name) => ({ type: "Sprite", name }))
                    );

                    return assets.map((asset): PreparedPreviewAsset => Object.freeze({
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
                catch (error)
                {
                    ApplicationLogger.warning(
                        ApplicationLogSource.modLibrary,
                        `Optional Animator face bundle "${bundleName}" could not be prepared.`,
                        error
                    );

                    return [];
                }
            })
        );

        return Object.freeze(
            prepared
                .flat()
                .sort((left, right) => left.name.localeCompare(right.name, "en-US") || left.bundleName.localeCompare(right.bundleName, "en-US"))
        );
    }

    private async readRuntimeFaceNames(runtime: CachedAnimatorRuntimePackage): Promise<readonly string[]> {
        const runtimeFile = runtime.files.find((file) => file.path === "runtime.json");
        if (!runtimeFile)
            throw new Error("The Animator runtime package has no manifest.");

        const contents = await fse.readFile(path.join(runtime.entryPath, runtimeFile.path), "utf-8");
        const manifest: unknown = JSON.parse(contents);

        if (!TypeCheck.isRecord(manifest))
            throw new Error("The Animator runtime manifest is invalid.");
        const scene = manifest.scene;
        if (!TypeCheck.isRecord(scene))
            throw new Error("The Animator runtime scene is invalid.");
        const interactions = scene.interactions;
        if (!TypeCheck.isRecord(interactions))
            throw new Error("The Animator runtime interactions are invalid.");
        const actor = interactions.actor;
        if (!TypeCheck.isRecord(actor))
            throw new Error("The Animator runtime Actor metadata is invalid.");
        const face = actor.face;
        if (!TypeCheck.isRecord(face))
            throw new Error("The Animator runtime face metadata is invalid.");

        const names = face.names;

        if (!Array.isArray(names) || names.length > 64 || !names.every((name) => TypeCheck.isValidString(name, 256)))
            throw new Error("The Animator runtime face-name list is invalid.");

        return Object.freeze([...new Set(names)]);
    }

    private getFaceBundleName(faceName: string): string {
        const separator = faceName.lastIndexOf("_");
        if (separator <= 0)
            throw new Error(`The Animator face "${faceName}" has an invalid name.`);

        return `face_${faceName.slice(0, separator).toLocaleLowerCase("en-US")}`;
    }

    private async findAnimatorSkin(skin2dId: string, variantId: string | null): Promise<AnimatorCharacterSkin> {
        const skin = await characterCatalog.findSkin(skin2dId, variantId);

        if (!skin)
            throw new UserFacingError("The mod's character skin is no longer present in the catalog.");
        if (!skin.isAnimatorSkin)
            throw new UserFacingError("The selected mod is not an Animator-skin mod.");

        return skin;
    }
}

export const animatorModPreviewService = new AnimatorModPreviewService();
