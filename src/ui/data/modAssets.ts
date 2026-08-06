export function getModAssetUrl(modId: string, assetName: string): string {
    return `lorplus-mod-asset://mod/${encodeURIComponent(modId)}/${encodeURIComponent(assetName)}`;
}
