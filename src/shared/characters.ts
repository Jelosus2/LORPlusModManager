export type CharacterSkin = Readonly<{
    skin2dId: string;
    variantId: string | null;
    characterName: string;
    skinName: string;
    iconFile: string;
    isSpineSkin: boolean;
    isAnimatorSkin: boolean;
    isStaticSkin: boolean;
    assets: readonly string[];
}>;

export type CharacterCatalog = Readonly<{
    version: string;
    characters: readonly CharacterSkin[];
}>;

export type CatalogIconRepairProgress = Readonly<{
    processed: number;
    total: number;
    downloaded: number;
    currentIcon: string | null;
}>;

export type CatalogIconRepairResult = Readonly<{
    required: number;
    bundled: number;
    cached: number;
    downloaded: number;
}>;
