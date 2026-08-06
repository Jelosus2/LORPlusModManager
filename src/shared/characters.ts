export type SpineHitbox = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}>;

export type SpinePreviewData = Readonly<{
    scale: number;
    baseSkin: string;
    defaultParts: boolean;
    defaultParts2: boolean;
    animations: Readonly<{
        idle: string;
        touch: string;
        specialTouch: string;
    }>;
    hitboxes: Readonly<{
        touch: SpineHitbox;
        specialTouch: readonly SpineHitbox[];
    }>;
}>;

type CharacterSkinBase = Readonly<{
    skin2dId: string;
    variantId: string | null;
    characterName: string;
    skinName: string;
    iconFile: string;
    isRPlusSkin: boolean;
    assets: readonly string[];
}>;

export type SpineCharacterSkin = CharacterSkinBase & Readonly<{
    isSpineSkin: true;
    isAnimatorSkin: false;
    isStaticSkin: false;
    spinePreview: SpinePreviewData;
}>;

export type AnimatorCharacterSkin = CharacterSkinBase & Readonly<{
    isSpineSkin: false;
    isAnimatorSkin: true;
    isStaticSkin: false;
    spinePreview?: never;
}>;

export type StaticCharacterSkin = CharacterSkinBase & Readonly<{
    isSpineSkin: false;
    isAnimatorSkin: false;
    isStaticSkin: true;
    spinePreview?: never;
}>;

export type CharacterSkin =
    | SpineCharacterSkin
    | AnimatorCharacterSkin
    | StaticCharacterSkin;

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
