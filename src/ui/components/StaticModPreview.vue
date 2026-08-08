<script setup lang="ts">
import type {
    PreviewSprite,
    PreviewTransform,
    PreparedStaticPreviewAsset,
    StaticCharacterSkin,
    StaticPreviewLayer,
    StaticPreviewSpriteSource,
    StaticPreviewFaceExpression,
    StaticPreviewHitbox,
    StaticPreviewRenderer,
    StaticPreviewSpriteMesh
} from "../../shared/characters";
import type { InstalledMod } from "../../shared/mod";

import ResetViewIcon from "./icons/ResetViewIcon.vue";
import HitboxIcon from "./icons/HitboxIcon.vue";

import { Application, Assets, Cache, Container, Graphics, Matrix, Rectangle, Sprite, Texture } from "pixi.js";
import { PixelateFilter } from "pixi-filters/pixelate";
import { ref, onMounted, onBeforeUnmount } from "vue";

import { getCachedPreviewAssetUrl } from "@/data/previewAssets";
import { getSkinBackgroundUrl } from "@/data/skinBackgrounds";
import { getModAssetUrl } from "@/data/modAssets";
import { ErrorUtils } from "@/utils/ErrorUtils";

type PreviewBounds = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

type CensorshipType =
    | "rplus"
    | "unedited"
    | "censored";

type FaceOption = StaticPreviewFaceExpression & Readonly<{
    label: string;
}>;

type SpriteLayerInstance = Readonly<{
    root: Container;
    sprite: Sprite;
    meshMask: Graphics | null;
}>;

type RuntimeLayer = Readonly<{
    definition: StaticPreviewLayer;
    normal: SpriteLayerInstance;
    censored: SpriteLayerInstance;
}>;

type RuntimeMaskLayer = Readonly<{
    definition: StaticPreviewLayer;
    instance: SpriteLayerInstance;
}>;

const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_SENSITIVITY = 0.0015;
const PAN_DRAG_THRESHOLD = 4;

const props = defineProps<{
    mod: InstalledMod;
    skin: StaticCharacterSkin;
}>();

const stageHost = ref<HTMLElement | null>(null);
const isLoading = ref(true);
const errorMessage = ref("");
const selectedCensorshipType = ref<CensorshipType>("unedited");
const availableCensorshipTypes = ref<ReadonlySet<CensorshipType>>(new Set<CensorshipType>());
const faceOptions = ref<readonly FaceOption[]>([]);
const selectedFaceAssetName = ref("");
const isDecoration1Enabled = ref(props.skin.staticPreview.defaultParts);
const isDecoration2Enabled = ref(props.skin.staticPreview.defaultParts2);
const areHitboxesVisible = ref(false);
const isPanning = ref(false);
const previewZoom = ref(100);

const instanceId = crypto.randomUUID();
const backgroundLayers = props.skin.backgroundPreview?.layers ?? [];

let preparedAssets: readonly PreparedStaticPreviewAsset[] = [];
let application: Application | null = null;
let previewScene: Container | null = null;
let characterRoot: Container | null = null;
let normalCharacterRoot: Container | null = null;
let censoredCharacterRoot: Container | null = null;
let mosaicMaskRoot: Container | null = null;
let hitboxLayer: Container | null = null;
let normalFace: SpriteLayerInstance | null = null;
let censoredFace: SpriteLayerInstance | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number | null = null;
let fittedPreviewScale = 1;
let activePanPointerId: number | null = null;
let panStartClientX = 0;
let panStartClientY = 0;
let panLastClientX = 0;
let panLastClientY = 0;
let didDragPreview = false;
let disposed = false;

const registeredAliases: string[] = [];
const croppedTextures: Texture[] = [];
const assetAliases = new Map<string, string>();
const staticRenderers = [
    ...props.skin.staticPreview.layers,
    ...props.skin.staticPreview.mosaicMasks,
    ...(props.skin.staticPreview.face
        ? [props.skin.staticPreview.face]
        : [])
];
const hasDecoration1 = staticRenderers.some((renderer) => renderer.visibility.part1 !== null);
const hasDecoration2 = staticRenderers.some((renderer) => renderer.visibility.part2 !== null);
const runtimeLayers: RuntimeLayer[] = [];
const runtimeMaskLayers: RuntimeMaskLayer[] = [];
const croppedTextureCache = new Map<string, Texture>();

async function createPreview() {
    const host = stageHost.value;
    if (!host)
        return;

    try
    {
        const preparation = await window.app.prepareStaticModPreview(props.mod.id);
        preparedAssets = preparation.assets;

        registerPreparedAssets(preparation.assets);
        registerBackgroundAssets();

        await Assets.load(registeredAliases);

        if (disposed)
            return;

        application = new Application();

        await application.init({
            resizeTo: host,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            preference: "webgl",
            powerPreference: "high-performance"
        });

        if (disposed)
            return;

        host.appendChild(application.canvas);

        previewScene = new Container();
        previewScene.sortableChildren = true;

        characterRoot = new Container();
        characterRoot.sortableChildren = true;
        characterRoot.zIndex = 0;

        normalCharacterRoot = new Container();
        normalCharacterRoot.sortableChildren = true;

        censoredCharacterRoot = new Container();
        censoredCharacterRoot.sortableChildren = true;
        censoredCharacterRoot.filters = [new PixelateFilter(12)];

        mosaicMaskRoot = new Container();
        mosaicMaskRoot.sortableChildren = true;

        censoredCharacterRoot.mask = mosaicMaskRoot;

        characterRoot.addChild(normalCharacterRoot);

        application.stage.addChild(previewScene);

        initializeControlState();

        createBackgroundLayers();
        createCharacterLayers();
        createFace();
        createMosaicMasks();
        createHitboxLayer();

        applyRenderState();

        previewScene.addChild(characterRoot);
        fitPreview();

        resizeObserver = new ResizeObserver(schedulePreviewFit);
        resizeObserver.observe(host);

        isLoading.value = false;
    }
    catch (error)
    {
        if (!disposed)
        {
            errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The static preview could not be loaded.");
            isLoading.value = false;
        }

        await destroyPreview();
    }
}

async function destroyPreview() {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (resizeFrame !== null)
    {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
    }

    const detachedCensoredRoot = censoredCharacterRoot && !censoredCharacterRoot.parent
        ? censoredCharacterRoot
        : null;

    if (normalCharacterRoot && censoredCharacterRoot && mosaicMaskRoot)
    {
        for (const runtime of runtimeLayers)
        {
            setContainerAttached(normalCharacterRoot, runtime.normal.root, true);
            setContainerAttached(censoredCharacterRoot, runtime.censored.root, true);
        }

        for (const runtime of runtimeMaskLayers)
            setContainerAttached(mosaicMaskRoot, runtime.instance.root, true);

        setContainerAttached(normalCharacterRoot, normalFace?.root ?? null, true);
        setContainerAttached(censoredCharacterRoot, censoredFace?.root ?? null, true);
        setContainerAttached(characterRoot, normalCharacterRoot, true);
        setContainerAttached(characterRoot, mosaicMaskRoot, true);
        setContainerAttached(characterRoot, censoredCharacterRoot, true);
        setContainerAttached(characterRoot, hitboxLayer, true);
        setContainerAttached(previewScene, characterRoot, true);
    }

    application?.destroy({ removeView: true }, { children: true });
    detachedCensoredRoot?.destroy({ children: true });

    application = null;
    previewScene = null;
    characterRoot = null;
    normalCharacterRoot = null;
    censoredCharacterRoot = null;
    mosaicMaskRoot = null;
    hitboxLayer = null;
    normalFace = null;
    censoredFace = null;
    activePanPointerId = null;
    didDragPreview = false;

    runtimeLayers.length = 0;
    runtimeMaskLayers.length = 0;
    croppedTextureCache.clear();

    isPanning.value = false;

    for (const texture of croppedTextures)
        texture.destroy(false);

    croppedTextures.length = 0;
    stageHost.value?.replaceChildren();

    await Promise.allSettled(registeredAliases.filter((alias) => Cache.has(alias)).map((alias) => Assets.unload(alias)));
}

function initializeControlState() {
    const available = new Set<CensorshipType>();
    const layers = props.skin.staticPreview.layers;

    if (layers.some((layer) => layer.sources.unedited !== null))
        available.add("unedited");

    const rPlusSources = layers
        .map((layer) => layer.sources.rplus)
        .filter((source): source is StaticPreviewSpriteSource => source !== null);

    const hasPreparedRPlusTexture = rPlusSources.length > 0 && rPlusSources.every((source) => {
        return getPreparedAsset("Texture2D", props.skin.staticPreview.assetBundleName, source.asset) !== undefined;
    });

    if (hasPreparedRPlusTexture)
    {
        available.add("rplus");

        if (props.skin.staticPreview.mosaicMasks.length > 0)
            available.add("censored");
    }

    availableCensorshipTypes.value = available;

    if (props.skin.isRPlusSkin && available.has("rplus"))
        selectedCensorshipType.value = "rplus";
    else if (available.has("unedited"))
        selectedCensorshipType.value = "unedited";
    else if (available.has("rplus"))
        selectedCensorshipType.value = "rplus";
}

function applyRenderState() {
    for (const runtime of runtimeLayers)
    {
        const source = resolveLayerSource(runtime.definition);
        const visible = !!source && isRendererVisible(runtime.definition);

        setContainerAttached(normalCharacterRoot, runtime.normal.root, visible);
        setContainerAttached(censoredCharacterRoot, runtime.censored.root, visible);

        if (!source)
            continue;

        configureLayerSprite(runtime.normal, runtime.definition, source);
        configureLayerSprite(runtime.censored, runtime.definition, source);
    }

    const shouldShowCensored = selectedCensorshipType.value === "censored";

    if (shouldShowCensored)
    {
        setContainerAttached(characterRoot, mosaicMaskRoot, true);
        setContainerAttached(characterRoot, censoredCharacterRoot, true);
    }
    else
    {
        setContainerAttached(characterRoot, censoredCharacterRoot, false);
        setContainerAttached(characterRoot, mosaicMaskRoot, false);
    }

    for (const runtime of runtimeMaskLayers)
        setContainerAttached(mosaicMaskRoot, runtime.instance.root, isRendererVisible(runtime.definition));

    const face = props.skin.staticPreview.face;

    if (face && normalFace && censoredFace)
    {
        const visible = selectedFaceAssetName.value !== "" && isRendererVisible(face);

        setContainerAttached(normalCharacterRoot, normalFace.root, visible);
        setContainerAttached(censoredCharacterRoot, censoredFace.root, visible);
    }
}

function registerPreparedAssets(assets: readonly PreparedStaticPreviewAsset[]) {
    for (const [index, asset] of assets.entries())
    {
        const alias = `static-preview-asset:${props.mod.id}:${instanceId}:${index}`;

        const url = asset.source === "game"
            ? getCachedPreviewAssetUrl(asset)
            : getModAssetUrl(props.mod.id, resolveModAssetName(asset.name));

        Assets.add({ alias, src: url });

        registeredAliases.push(alias);
        assetAliases.set(getAssetIdentity(asset.type, asset.bundleName, asset.name), alias);
    }
}

function registerBackgroundAssets() {
    for (const [index, layer] of backgroundLayers.entries())
    {
        const url = getSkinBackgroundUrl(layer.file);
        if (!url)
            throw new Error(`The preview background "${layer.file}" is unavailable.`);

        const alias = `static-preview-background:${props.mod.id}:${instanceId}:${index}`;

        Assets.add({ alias, src: url });
        registeredAliases.push(alias);
    }
}

function createBackgroundLayers() {
    if (!previewScene)
        return;

    for (const [index, layer] of backgroundLayers.entries())
    {
        const alias = `static-preview-background:${props.mod.id}:${instanceId}:${index}`;

        const texture = Assets.get<Texture>(alias);
        if (!texture)
            throw new Error(`The preview background "${layer.file}" could not be loaded.`);

        const root = new Container();
        root.zIndex = layer.sortingOrder;
        root.setFromMatrix(toPixiMatrix(layer.transform));

        const sprite = new Sprite(texture);
        sprite.anchor.set(layer.pivot.x, 1 - layer.pivot.y);
        sprite.width = layer.width;
        sprite.height = layer.height;

        root.addChild(sprite);
        previewScene.addChild(root);
    }
}

function createCharacterLayers() {
    if (!normalCharacterRoot || !censoredCharacterRoot)
        return;

    for (const layer of props.skin.staticPreview.layers)
    {
        const source = resolveLayerSource(layer);
        if (!source)
            continue;

        const normal = createSpriteLayer(layer, source);
        const censored = createSpriteLayer(layer, source);

        normalCharacterRoot.addChild(normal.root);
        censoredCharacterRoot.addChild(censored.root);

        runtimeLayers.push({
            definition: layer,
            normal,
            censored
        });
    }
}

function createSpriteLayer(layer: StaticPreviewLayer, source: StaticPreviewSpriteSource): SpriteLayerInstance {
    const sprite = new Sprite();
    const meshMask = new Graphics();

    const root = new Container();
    root.zIndex = layer.sortingOrder;
    root.setFromMatrix(toPixiMatrix(layer.transform));
    root.addChild(sprite, meshMask);

    const instance: SpriteLayerInstance = {
        root,
        sprite,
        meshMask
    };

    configureLayerSprite(instance, layer, source);

    return instance;
}

function configureLayerSprite(instance: SpriteLayerInstance, layer: StaticPreviewLayer, source: StaticPreviewSpriteSource) {
    const { sprite, meshMask } = instance;

    sprite.texture = getCroppedTexture(source);
    sprite.scale.set(1);
    sprite.anchor.set(source.pivot.x, 1 - source.pivot.y);
    sprite.width = source.width;
    sprite.height = source.height;
    sprite.tint = colorToTint(layer.color);
    sprite.alpha = layer.color.a;

    if (layer.flipX)
        sprite.scale.x *= -1;
    if (layer.flipY)
        sprite.scale.y *= -1;

    if (meshMask && source.mesh)
    {
        configureSpriteMeshMask(meshMask, source.mesh, layer);
        sprite.mask = meshMask;
        return;
    }

    meshMask?.clear();
    sprite.mask = null;
}

function configureSpriteMeshMask(meshMask: Graphics, mesh: StaticPreviewSpriteMesh, layer: StaticPreviewLayer) {
    meshMask.clear();
    meshMask.scale.set(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);

    const { vertices, triangles } = mesh;

    for (let index = 0; index < triangles.length; index += 3)
    {
        const first = triangles[index] * 2;
        const second = triangles[index + 1] * 2;
        const third = triangles[index + 2] * 2;

        meshMask.poly([
            vertices[first],
            -vertices[first + 1],
            vertices[second],
            -vertices[second + 1],
            vertices[third],
            -vertices[third + 1]
        ], true);
    }

    meshMask.fill({ color: 0xffffff });
}

function getCroppedTexture(source: StaticPreviewSpriteSource): Texture {
    const alias = getRequiredAssetAlias("Texture2D", props.skin.staticPreview.assetBundleName, source.asset);
    const texture = Assets.get<Texture>(alias);

    if (!texture)
        throw new Error(`The texture "${source.asset}" could not be loaded.`);

    return createCroppedTexture(texture, source);
}

function resolveLayerSource(layer: StaticPreviewLayer): StaticPreviewSpriteSource | null {
    if ((selectedCensorshipType.value === "rplus"|| selectedCensorshipType.value === "censored") && layer.sources.rplus)
        return layer.sources.rplus;

    return layer.sources.unedited ?? layer.sources.rplus;
}

function createFace() {
    if (!normalCharacterRoot || !censoredCharacterRoot)
        return;

    const face = props.skin.staticPreview.face;
    if (!face || face.expressions.length === 0)
        return;

    faceOptions.value = face.expressions.map((expression) => ({
        ...expression,
        label: formatFaceLabel(expression.assetName)
    }));

    selectedFaceAssetName.value = "";

    normalFace = createFaceInstance(face);
    censoredFace = createFaceInstance(face);

    normalCharacterRoot.addChild(normalFace.root);
    censoredCharacterRoot.addChild(censoredFace.root);

    applySelectedFace();
}

function createFaceInstance(face: NonNullable<StaticCharacterSkin["staticPreview"]["face"]>): SpriteLayerInstance {
    const sprite = new Sprite();

    sprite.tint = colorToTint(face.color);
    sprite.alpha = face.color.a;

    const root = new Container();
    root.zIndex = face.sortingOrder;
    root.setFromMatrix(toPixiMatrix(face.transform));
    root.addChild(sprite);

    return {
        root,
        sprite,
        meshMask: null
    };
}

function applySelectedFace() {
    const face = props.skin.staticPreview.face;
    if (!face || !normalFace || !censoredFace)
        return;

    const expression = face.expressions.find((candidate) => candidate.assetName === selectedFaceAssetName.value);
    const visible = !!expression && isRendererVisible(face);

    setContainerAttached(normalCharacterRoot, normalFace.root, visible);
    setContainerAttached(censoredCharacterRoot, censoredFace.root, visible);

    if (!expression)
        return;

    const alias = getRequiredAssetAlias("Sprite", expression.bundleName, expression.assetName);
    const asset = getPreparedAsset("Sprite", expression.bundleName, expression.assetName);
    const texture = Assets.get<Texture>(alias);
    const geometry = asset?.sprite;

    if (!texture || !geometry)
        return;

    for (const instance of [normalFace, censoredFace])
    {
        const sprite = instance.sprite;

        sprite.texture = texture;
        sprite.scale.set(1);
        sprite.anchor.set(geometry.pivot.x, 1 - geometry.pivot.y);
        sprite.width = geometry.pixelWidth / geometry.pixelsPerUnit;
        sprite.height = geometry.pixelHeight / geometry.pixelsPerUnit;

        if (face.flipX)
            sprite.scale.x *= -1;

        if (face.flipY)
            sprite.scale.y *= -1;
    }
}

function createCroppedTexture(texture: Texture, source: StaticPreviewSpriteSource): Texture {
    const cacheKey = JSON.stringify([
        source.asset.toLocaleLowerCase("en-US"),
        source.crop.x,
        source.crop.y,
        source.crop.width,
        source.crop.height
    ]);

    const existingTexture = croppedTextureCache.get(cacheKey);
    if (existingTexture)
        return existingTexture;

    const sourceWidth = texture.source.width;
    const sourceHeight = texture.source.height;
    const tolerance = 0.5;

    const frameX = source.crop.x;
    const frameY = sourceHeight - source.crop.y - source.crop.height;

    if (
        frameX < -tolerance ||
        frameY < -tolerance ||
        frameX + source.crop.width > sourceWidth + tolerance ||
        frameY + source.crop.height > sourceHeight + tolerance
    )
    {
        throw new Error(`The sprite crop for "${source.asset}" is outside its texture.`);
    }

    const frame = new Rectangle(
        Math.max(0, frameX),
        Math.max(0, frameY),
        Math.min(source.crop.width, sourceWidth - Math.max(0, frameX)),
        Math.min(source.crop.height, sourceHeight - Math.max(0, frameY))
    );

    const croppedTexture = new Texture({
        source: texture.source,
        frame
    });

    croppedTextures.push(croppedTexture);
    croppedTextureCache.set(cacheKey, croppedTexture);

    return croppedTexture;
}

function fitPreview() {
    if (!application || !previewScene || !normalCharacterRoot)
        return;

    const screenWidth = application.screen.width;
    const screenHeight = application.screen.height;
    const camera = props.skin.backgroundPreview?.camera;

    if (camera)
    {
        const bounds = getTransformedSpriteBounds(camera);
        const scale = Math.max(screenWidth / bounds.width, screenHeight / bounds.height) / camera.zoom;

        setFittedPreviewView(
            scale,
            screenWidth / 2 - (bounds.x + bounds.width / 2) * scale,
            screenHeight / 2 - (bounds.y + bounds.height / 2) * scale
        );

        return;
    }

    const bounds = normalCharacterRoot.getLocalBounds();
    if (bounds.width <= 0 || bounds.height <= 0)
        return;

    const padding = Math.min(64, screenWidth * 0.06,  screenHeight * 0.06);
    const availableWidth = Math.max(screenWidth - padding * 2, 1);
    const availableHeight = Math.max(screenHeight - padding * 2, 1);
    const scale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);

    setFittedPreviewView(
        scale,
        screenWidth / 2 - (bounds.minX + bounds.width / 2) * scale,
        screenHeight / 2 - (bounds.minY + bounds.height / 2) * scale
    );
}

function setFittedPreviewView(scale: number, x: number, y: number) {
    if (!previewScene)
        return;

    fittedPreviewScale = scale;
    previewScene.scale.set(scale);
    previewScene.position.set(x, y);
    previewZoom.value = 100;
}

function schedulePreviewFit() {
    if (resizeFrame !== null)
        window.cancelAnimationFrame(resizeFrame);

    resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        application?.resize();
        fitPreview();
    });
}

function isRendererVisible(renderer: StaticPreviewRenderer): boolean {
    const visibility = renderer.visibility;

    if (!visibility.defaultVisible)
        return false;
    if (visibility.part1 === "on" && !isDecoration1Enabled.value)
        return false;
    if (visibility.part1 === "off" && isDecoration1Enabled.value)
        return false;
    if (visibility.part2 === "on" && !isDecoration2Enabled.value)
        return false;

    return true;
}

function createMosaicMasks() {
    if (!mosaicMaskRoot)
        return;

    for (const layer of props.skin.staticPreview.mosaicMasks)
    {
        const source = layer.sources.rplus ?? layer.sources.unedited;
        if (!source)
            continue;

        const instance = createSpriteLayer(layer, source);

        mosaicMaskRoot.addChild(instance.root);

        runtimeMaskLayers.push({
            definition: layer,
            instance
        });
    }
}

function createHitboxLayer() {
    if (!characterRoot)
        return;

    hitboxLayer = new Container();
    hitboxLayer.zIndex = 1_000_000;
    hitboxLayer.addChild(createHitboxGraphic(props.skin.staticPreview.hitboxes.touch, "touch"));

    for (const hitbox of props.skin.staticPreview.hitboxes.specialTouch)
        hitboxLayer.addChild(createHitboxGraphic(hitbox, "special"));

    setContainerAttached(characterRoot, hitboxLayer, areHitboxesVisible.value);
}

function createHitboxGraphic(hitbox: StaticPreviewHitbox, kind: "touch" | "special"): Container {
    const color = kind === "special" ? 0xe5a06d : 0x91b8cf;

    const graphic = new Graphics()
        .rect(-hitbox.width / 2, -hitbox.height / 2, hitbox.width, hitbox.height)
        .fill({ color, alpha: kind === "special" ? 0.14 : 0.09 })
        .stroke({ color, alpha: 0.95, width: 1, pixelLine: true });

    const root = new Container();
    root.setFromMatrix(toPixiMatrix(hitbox.transform));
    root.addChild(graphic);

    return root;
}

function toggleHitboxVisibility() {
    areHitboxesVisible.value = !areHitboxesVisible.value;
    setContainerAttached(characterRoot, hitboxLayer, areHitboxesVisible.value);
}

function getPreparedAsset(type: PreparedStaticPreviewAsset["type"], bundleName: string, name: string): PreparedStaticPreviewAsset | undefined {
    const identity = getAssetIdentity(type, bundleName, name);
    return preparedAssets.find((asset) => getAssetIdentity(asset.type, asset.bundleName, asset.name) === identity);
}

function getRequiredAssetAlias(type: PreparedStaticPreviewAsset["type"], bundleName: string, name: string): string {
    const alias = assetAliases.get(getAssetIdentity(type, bundleName, name));
    if (!alias)
        throw new Error(`The preview asset "${name}" was not prepared.`);

    return alias;
}

function getAssetIdentity(type: PreparedStaticPreviewAsset["type"], bundleName: string, name: string): string {
    return JSON.stringify([
        type,
        bundleName.toLocaleLowerCase("en-US"),
        name.toLocaleLowerCase("en-US")
    ]);
}

function resolveModAssetName(expectedName: string): string {
    const normalizedExpected = expectedName.toLocaleLowerCase("en-US");
    return props.mod.assetNames.find((name) => name.toLocaleLowerCase("en-US") === normalizedExpected) ?? expectedName;
}

function colorToTint(color: Readonly<{ r: number; g: number; b: number }>): number {
    const toByte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

    return (
        (toByte(color.r) << 16) |
        (toByte(color.g) << 8) |
        toByte(color.b)
    );
}

function getTransformedSpriteBounds(sprite: PreviewSprite): PreviewBounds {
    const left = -sprite.pivot.x * sprite.width;
    const top = -(1 - sprite.pivot.y) * sprite.height;

    return getTransformedRectangleBounds(left, top, sprite.width, sprite.height, toPixiMatrix(sprite.transform));
}

function getTransformedRectangleBounds(x: number,y: number, width: number, height: number, transform: Matrix): PreviewBounds {
    const points = [
        transformPoint(transform, x, y),
        transformPoint(transform, x + width, y),
        transformPoint(transform, x, y + height),
        transformPoint(transform, x + width, y + height)
    ];

    const minimumX = Math.min(...points.map((point) => point.x));
    const maximumX = Math.max(...points.map((point) => point.x));
    const minimumY = Math.min(...points.map((point) => point.y));
    const maximumY = Math.max(...points.map((point) => point.y));

    return {
        x: minimumX,
        y: minimumY,
        width: maximumX - minimumX,
        height: maximumY - minimumY
    };
}

function transformPoint(matrix: Matrix, x: number, y: number) {
    return {
        x: matrix.a * x + matrix.c * y + matrix.tx,
        y: matrix.b * x + matrix.d * y + matrix.ty
    };
}

function toPixiMatrix(transform: PreviewTransform): Matrix {
    return new Matrix(transform.a, -transform.b, -transform.c, transform.d, transform.tx, -transform.ty);
}

function toggleDecoration(group: 1 | 2) {
    if (group === 1)
        isDecoration1Enabled.value = !isDecoration1Enabled.value;
    else
        isDecoration2Enabled.value = !isDecoration2Enabled.value;

    applyRenderState();
}

function formatFaceLabel(assetName: string): string {
    const finalPart = assetName.split("_").pop() ?? assetName;

    return finalPart
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z])(\d+)/g, "$1 $2")
        .replaceAll("_", " ");
}

function resetPreviewView() {
    didDragPreview = false;
    fitPreview();
}

function handlePreviewWheel(event: WheelEvent) {
    if (!previewScene || fittedPreviewScale <= 0)
        return;

    const pointer = getPreviewPointerPosition(event);
    if (!pointer)
        return;

    const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? stageHost.value?.clientHeight ?? 1
            : 1;

    const normalizedDelta = event.deltaY * deltaMultiplier;
    const currentScale = previewScene.scale.x;
    const currentZoom = currentScale / fittedPreviewScale;

    const nextZoom = Math.min(
        MAX_PREVIEW_ZOOM,
        Math.max( MIN_PREVIEW_ZOOM, currentZoom * Math.exp(-normalizedDelta * PREVIEW_ZOOM_SENSITIVITY))
    );

    const nextScale = fittedPreviewScale * nextZoom;
    if (Math.abs(nextScale - currentScale) < 0.0001)
        return;

    const localPointerX = (pointer.x - previewScene.position.x) / currentScale;
    const localPointerY = (pointer.y - previewScene.position.y) / currentScale;

    previewScene.scale.set(nextScale);
    previewScene.position.set(pointer.x - localPointerX * nextScale, pointer.y - localPointerY * nextScale);

    previewZoom.value = Math.round(nextZoom * 100);
}

function startPreviewPan(event: PointerEvent) {
    if (!previewScene || activePanPointerId !== null || (event.button !== 0 && event.button !== 1))
        return;

    const target = event.currentTarget as HTMLElement;

    activePanPointerId = event.pointerId;
    panStartClientX = event.clientX;
    panStartClientY = event.clientY;
    panLastClientX = event.clientX;
    panLastClientY = event.clientY;
    didDragPreview = false;
    isPanning.value = false;

    target.setPointerCapture(event.pointerId);

    if (event.button === 1)
        event.preventDefault();
}

function movePreviewPan(event: PointerEvent) {
    if (!previewScene || !application || activePanPointerId !== event.pointerId)
        return;

    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0)
        return;

    if (!didDragPreview)
    {
        const dragDistance = Math.hypot(event.clientX - panStartClientX, event.clientY - panStartClientY);
        if (dragDistance < PAN_DRAG_THRESHOLD)
            return;

        didDragPreview = true;
        isPanning.value = true;
    }

    const deltaX = event.clientX - panLastClientX;
    const deltaY = event.clientY - panLastClientY;

    previewScene.position.x += deltaX * application.screen.width / bounds.width;
    previewScene.position.y += deltaY * application.screen.height / bounds.height;

    panLastClientX = event.clientX;
    panLastClientY = event.clientY;

    event.preventDefault();
}

function finishPreviewPan(event: PointerEvent) {
    if (activePanPointerId !== event.pointerId)
        return;

    const target = event.currentTarget as HTMLElement;
    const pointerId = activePanPointerId;

    activePanPointerId = null;
    isPanning.value = false;

    if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId);

    window.setTimeout(() => {
        didDragPreview = false;
    }, 0);
}

function setContainerAttached(parent: Container | null, child: Container | null, attached: boolean) {
    if (!parent || !child)
        return;

    if (attached)
    {
        if (child.parent !== parent)
            parent.addChild(child);
    }
    else if (child.parent === parent)
    {
        parent.removeChild(child);
    }
}

function getPreviewPointerPosition(event: MouseEvent) {
    const host = stageHost.value;
    if (!host || !application)
        return null;

    const bounds = host.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0)
        return null;

    return {
        x: (event.clientX - bounds.left) * application.screen.width / bounds.width,
        y: (event.clientY - bounds.top) * application.screen.height / bounds.height
    };
}

onMounted(createPreview);

onBeforeUnmount(() => {
    disposed = true;
    void destroyPreview();
});
</script>

<template>
    <section
        class="static-preview"
        :aria-busy="isLoading"
        :aria-label="`Static preview for ${mod.directoryName}`"
    >
        <div
            ref="stageHost"
            class="static-preview-canvas"
            :class="{
                'is-hidden': isLoading || errorMessage,
                'is-panning': isPanning
            }"
            @wheel.prevent="handlePreviewWheel"
            @pointerdown="startPreviewPan"
            @pointermove="movePreviewPan"
            @pointerup="finishPreviewPan"
            @pointercancel="finishPreviewPan"
            @lostpointercapture="finishPreviewPan"
        ></div>

        <div
            v-if="!isLoading && !errorMessage"
            class="static-preview-controls"
        >
            <label class="static-preview-control">
                <span>Censorship</span>

                <span class="static-preview-select-wrap">
                    <select
                        v-model="selectedCensorshipType"
                        aria-label="Censorship type"
                        @change="applyRenderState"
                    >
                        <option
                            value="rplus"
                            :disabled="!availableCensorshipTypes.has('rplus')"
                        >
                            R+{{ availableCensorshipTypes.has("rplus") ? "" : " (not available)" }}
                        </option>
                        <option
                            value="unedited"
                            :disabled="!availableCensorshipTypes.has('unedited')"
                        >
                            Unedited
                        </option>
                        <option
                            value="censored"
                            :disabled="!availableCensorshipTypes.has('censored')"
                        >
                            Censored{{ availableCensorshipTypes.has("censored") ? "" : " (not available)" }}
                        </option>
                    </select>

                    <span
                        class="static-preview-select-caret"
                        aria-hidden="true"
                    ></span>
                </span>
            </label>

            <label
                v-if="faceOptions.length > 0"
                class="static-preview-control static-preview-face-control"
            >
                <span>Face</span>

                <span class="static-preview-select-wrap">
                    <select
                        v-model="selectedFaceAssetName"
                        aria-label="Face expression"
                        @change="applySelectedFace"
                    >
                        <option value="">
                            Default
                        </option>

                        <option
                            v-for="face in faceOptions"
                            :key="face.assetName"
                            :value="face.assetName"
                            :title="face.assetName"
                        >
                            {{ face.label }}
                        </option>
                    </select>

                    <span
                        class="static-preview-select-caret"
                        aria-hidden="true"
                    ></span>
                </span>
            </label>

            <div
                v-if="hasDecoration1 || hasDecoration2"
                class="static-preview-decoration-control"
            >
                <span>Decorations</span>

                <div class="static-preview-decoration-buttons">
                    <button
                        v-if="hasDecoration1"
                        :class="{ 'is-active': isDecoration1Enabled }"
                        type="button"
                        :aria-pressed="isDecoration1Enabled"
                        title="Toggle decoration set 1"
                        @click="toggleDecoration(1)"
                    >
                        1
                    </button>

                    <button
                        v-if="hasDecoration2"
                        :class="{ 'is-active': isDecoration2Enabled }"
                        type="button"
                        :aria-pressed="isDecoration2Enabled"
                        title="Toggle decoration set 2"
                        @click="toggleDecoration(2)"
                    >
                        2
                    </button>
                </div>
            </div>

            <button
                class="static-preview-tool-button"
                :class="{ 'is-active': areHitboxesVisible }"
                type="button"
                :aria-pressed="areHitboxesVisible"
                :aria-label="areHitboxesVisible ? 'Hide touch areas' : 'Show touch areas'"
                :title="areHitboxesVisible ? 'Hide touch areas' : 'Show touch areas'"
                @click="toggleHitboxVisibility"
            >
                <HitboxIcon />
            </button>
        </div>

        <div
            v-if="!isLoading && !errorMessage"
            class="static-preview-navigation"
        >
            <span class="static-preview-navigation-hint">Drag to pan &middot; Scroll to zoom</span>
            <span class="static-preview-zoom-value">{{ previewZoom }}%</span>

            <button
                class="static-preview-reset-view"
                type="button"
                title="Reset zoom and position"
                aria-label="Reset zoom and position"
                @click="resetPreviewView"
            >
                <ResetViewIcon />
            </button>
        </div>

        <div
            v-if="isLoading"
            class="static-preview-state"
            role="status"
        >
            <span class="static-preview-spinner" aria-hidden="true"></span>
            <strong>Loading preview</strong>
            <p>Preparing and assembling the static skin assets.</p>
        </div>

        <div
            v-else-if="errorMessage"
            class="static-preview-state is-error"
            role="alert"
        >
            <span class="static-preview-error-mark" aria-hidden="true">!</span>
            <strong>Preview unavailable</strong>
            <p>{{ errorMessage }}</p>
        </div>
    </section>
</template>

<style scoped>
.static-preview {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.static-preview-canvas {
    width: 100%;
    height: 100%;
    opacity: 1;
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: opacity 150ms ease;
}

.static-preview-canvas.is-panning,
.static-preview-canvas.is-panning :deep(canvas) {
    cursor: grabbing !important;
}

.static-preview-canvas.is-hidden {
    opacity: 0;
}

.static-preview-canvas :deep(canvas) {
    display: block;
    width: 100%;
    height: 100%;
}

.static-preview-controls {
    position: absolute;
    z-index: 2;
    top: 18px;
    right: 20px;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
}

.static-preview-control,
.static-preview-decoration-control {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
    color: #9da39d;
    font-size: 11px;
    font-weight: 700;
}

.static-preview-control {
    width: 158px;
}

.static-preview-face-control {
    width: 180px;
}

.static-preview-select-wrap {
    position: relative;
    display: block;
}

.static-preview-select-wrap select {
    width: 100%;
    height: 42px;
    padding: 0 38px 0 12px;
    appearance: none;
    border: 1px solid #303632;
    border-radius: 7px;
    outline: none;
    color: #e4e0d7;
    background: rgba(18, 22, 19, 0.94);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.24);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}

.static-preview-select-wrap select:hover {
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.static-preview-select-wrap select:disabled {
    color: #898f89;
    cursor: default;
}

.static-preview-select-wrap select:focus-visible,
.static-preview-decoration-buttons button:focus-visible,
.static-preview-tool-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.static-preview-select-caret {
    position: absolute;
    top: 50%;
    right: 14px;
    width: 7px;
    height: 7px;
    border-right: 2px solid #9ca39d;
    border-bottom: 2px solid #9ca39d;
    pointer-events: none;
    transform: translateY(-68%) rotate(45deg);
}

.static-preview-decoration-buttons {
    display: flex;
    gap: 6px;
}

.static-preview-decoration-buttons button,
.static-preview-tool-button {
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    padding: 0;
    place-items: center;
    border: 1px solid #303632;
    border-radius: 7px;
    color: #aeb3ad;
    background: rgba(18, 22, 19, 0.94);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.24);
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}

.static-preview-decoration-buttons button:hover,
.static-preview-tool-button:hover {
    color: #f2eee5;
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.static-preview-decoration-buttons button.is-active,
.static-preview-tool-button.is-active {
    color: #b9ddf2;
    border-color: #50758a;
    background: rgba(20, 39, 49, 0.96);
}

.static-preview-tool-button svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.static-preview-navigation {
    position: absolute;
    z-index: 2;
    right: 20px;
    bottom: 18px;
    display: flex;
    align-items: center;
    min-height: 38px;
    padding: 4px 5px 4px 13px;
    gap: 10px;
    border: 1px solid rgba(56, 63, 59, 0.92);
    border-radius: 8px;
    color: #aeb3ad;
    background: rgba(14, 18, 15, 0.9);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(8px);
}

.static-preview-navigation-hint {
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}

.static-preview-zoom-value {
    min-width: 42px;
    color: #d9d7cf;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    text-align: right;
}

.static-preview-reset-view {
    display: grid;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 6px;
    color: #aeb3ad;
    background: #191e1a;
    cursor: pointer;
}

.static-preview-reset-view:hover {
    color: #f2eee5;
    background: #252b27;
}

.static-preview-reset-view:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.static-preview-reset-view svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.static-preview-state {
    position: absolute;
    z-index: 3;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 32px;
    color: #858b85;
    text-align: center;
}

.static-preview-state strong,
.static-preview-state p {
    margin: 0;
}

.static-preview-state strong {
    color: #dedbd3;
    font-size: 15px;
}

.static-preview-state p {
    max-width: 480px;
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
}

.static-preview-spinner {
    width: 34px;
    height: 34px;
    margin-bottom: 16px;
    border: 3px solid #263137;
    border-top-color: #91b8cf;
    border-radius: 50%;
    animation: static-preview-spin 750ms linear infinite;
}

.static-preview-error-mark {
    display: grid;
    width: 38px;
    height: 38px;
    margin-bottom: 14px;
    place-items: center;
    border-radius: 50%;
    color: #f0aaa5;
    background: #301d1d;
    font-size: 20px;
    font-weight: 800;
}

.static-preview-state.is-error p {
    color: #d49b97;
}

@keyframes static-preview-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 760px) {
    .static-preview-navigation-hint {
        display: none;
    }
}
</style>
