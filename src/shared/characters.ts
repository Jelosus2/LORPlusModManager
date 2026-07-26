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
