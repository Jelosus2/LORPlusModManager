import type { PreparedPreviewAsset } from "../../shared/characters";

export function getCachedPreviewAssetUrl(asset: PreparedPreviewAsset): string {
    if (asset.source !== "game" || !asset.cacheKey || !asset.versionHash)
        throw new Error("The preview asset is not a cached game asset.");

    return (
        `lorplus-preview-asset://cache/` +
        `${encodeURIComponent(asset.bundleName)}/` +
        `${encodeURIComponent(asset.versionHash)}/` +
        `${encodeURIComponent(asset.cacheKey)}.png`
    );
}
