import type {AnimatorCharacterSkin, AnimatorModPreviewPreparation} from "../../shared/characters.js";

import { unityPreviewAssetCache } from "./UnityPreviewAssetCacheService.js";
import { ModRepository } from "#database/repositories/ModRepository.js";
import { characterCatalog } from "#utils/CharacterCatalogService.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { StringUtils } from "#utils/StringUtils.js";
import { ModVerifier } from "./ModVerifier.js";

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

        return Object.freeze({
            modId: mod.id,
            skin2dId: skin.skin2dId,
            variantId: skin.variantId,
            runtime: Object.freeze({
                bundleName: runtime.bundleName,
                versionHash: runtime.versionHash,
                cacheKey: runtime.key,
                formatVersion: runtime.formatVersion
            })
        });
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
