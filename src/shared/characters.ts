export type PreviewVector = Readonly<{
    x: number;
    y: number;
}>;

export type PreviewTransform = Readonly<{
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
}>;

export type PreviewSprite = Readonly<{
    width: number;
    height: number;
    pivot: PreviewVector;
    transform: PreviewTransform;
}>;

export type BackgroundPreviewLayer = PreviewSprite & Readonly<{
    file: string;
    sortingOrder: number;
}>;

export type CharacterBackgroundPreview = Readonly<{
    layers: readonly BackgroundPreviewLayer[];
    camera: (PreviewSprite & Readonly<{
        zoom: number;
    }>) | null;
}>;

export type SpineHitbox = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
}>;

export type SpineAnimationSet = Readonly<{
    idle: string;
    touch: string | null;
    specialTouch: string;
}>;

export type SpineMosaicMask = PreviewSprite & Readonly<{
    boneName: string;
    referenceScreenSize: number;
    minMultiplier: number;
    maxMultiplier: number;
}>;

export type SpinePreviewData = Readonly<{
    scale: number;
    transform: PreviewTransform;
    baseSkin: string;
    defaultParts: boolean;
    defaultParts2: boolean;
    animations: Readonly<{
        idle: string;
        touch: string;
        specialTouch: string;
        postSpecialTouch: SpineAnimationSet | null;
    }>;
    mosaicMasks: readonly SpineMosaicMask[];
    hitboxes: Readonly<{
        touch: SpineHitbox;
        specialTouch: readonly SpineHitbox[];
    }>;
}>;

export type PreviewColor = Readonly<{
    r: number;
    g: number;
    b: number;
    a: number;
}>;

export type PreviewRectangle = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

export type StaticPreviewVisibility = Readonly<{
    defaultVisible: boolean;
    part1: "on" | "off" | null;
    part2: "on" | null;
}>;

export type StaticPreviewSpriteMesh = Readonly<{
    vertices: readonly number[];
    triangles: readonly number[];
}>;

export type StaticPreviewSpriteSource = Readonly<{
    asset: string | null;
    generated: "white" | null;
    crop: PreviewRectangle;
    width: number;
    height: number;
    pivot: PreviewVector;
    mesh: StaticPreviewSpriteMesh | null;
}>;

export type StaticPreviewRenderer = Readonly<{
    sortingOrder: number;
    color: PreviewColor;
    transform: PreviewTransform;
    flipX: boolean;
    flipY: boolean;
    visibility: StaticPreviewVisibility;
}>;

export type StaticPreviewLayer = StaticPreviewRenderer & Readonly<{
    name: string;
    sources: Readonly<{
        unedited: StaticPreviewSpriteSource | null;
        rplus: StaticPreviewSpriteSource | null;
    }>;
}>;

export type PreviewFaceExpression = Readonly<{
    assetName: string;
    bundleName: string;
}>;

export type StaticPreviewFaceExpression = PreviewFaceExpression;

export type StaticPreviewFace = StaticPreviewRenderer & Readonly<{
    expressions: readonly StaticPreviewFaceExpression[];
}>;

export type StaticPreviewHitbox = Readonly<{
    width: number;
    height: number;
    transform: PreviewTransform;
}>;

export type StaticPreviewData = Readonly<{
    assetBundleName: string;
    defaultParts: boolean;
    defaultParts2: boolean;
    face: StaticPreviewFace | null;
    layers: readonly StaticPreviewLayer[];
    mosaicMasks: readonly StaticPreviewLayer[];
    hitboxes: Readonly<{
        touch: StaticPreviewHitbox;
        specialTouch: readonly StaticPreviewHitbox[];
    }>;
}>;

type CharacterSkinBase = Readonly<{
    skin2dId: string;
    variantId: string | null;
    characterName: string;
    skinName: string;
    iconFile: string;
    isRPlusSkin: boolean;
    backgroundPreview: CharacterBackgroundPreview | null;
    assets: readonly string[];
}>;

export type SpineCharacterSkin = CharacterSkinBase & Readonly<{
    isSpineSkin: true;
    isAnimatorSkin: false;
    isStaticSkin: false;
    spinePreview: SpinePreviewData;
    animatorPreview?: never;
    staticPreview?: never;
}>;

export type AnimatorCharacterSkin = CharacterSkinBase & Readonly<{
    isSpineSkin: false;
    isAnimatorSkin: true;
    isStaticSkin: false;
    animatorPreview: AnimatorPreviewData;
    spinePreview?: never;
    staticPreview?: never;
}>;

export type StaticCharacterSkin = CharacterSkinBase & Readonly<{
    isSpineSkin: false;
    isAnimatorSkin: false;
    isStaticSkin: true;
    staticPreview: StaticPreviewData;
    spinePreview?: never;
    animatorPreview?: never;
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

export type CatalogBackgroundRepairProgress = Readonly<{
    processed: number;
    total: number;
    downloaded: number;
    currentBackground: string | null;
}>;

export type CatalogBackgroundRepairResult = Readonly<{
    required: number;
    bundled: number;
    cached: number;
    downloaded: number;
}>;

export type PreparedPreviewSpriteGeometry = Readonly<{
    pixelWidth: number;
    pixelHeight: number;
    pixelsPerUnit: number;
    pivot: PreviewVector;
}>;

export type PreparedPreviewAsset = Readonly<{
    type: "Texture2D" | "Sprite";
    name: string;
    bundleName: string;
    source: "mod" | "game";
    cacheKey: string | null;
    versionHash: string | null;
    sprite: PreparedPreviewSpriteGeometry | null;
}>;

export type PreparedStaticPreviewAsset = PreparedPreviewAsset;

export type AnimatorPreviewData = Readonly<{
    faces: readonly PreviewFaceExpression[];
}>;

export type StaticModPreviewPreparation = Readonly<{
    modId: string;
    skin2dId: string;
    variantId: string | null;
    assets: readonly PreparedStaticPreviewAsset[];
}>;

export type AnimatorRuntimeReference = Readonly<{
    bundleName: string;
    versionHash: string;
    cacheKey: string;
    formatVersion: number;
}>;

export type AnimatorModPreviewPreparation = Readonly<{
    modId: string;
    skin2dId: string;
    variantId: string | null;
    runtime: AnimatorRuntimeReference;
    faces: readonly PreparedPreviewAsset[];
}>;
