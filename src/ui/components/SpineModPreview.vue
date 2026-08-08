<script setup lang="ts">
import type { SpineCharacterSkin, SpineHitbox, PreviewSprite, PreviewTransform } from "../../shared/characters";
import type { InstalledMod } from "../../shared/mod";

import ResetStateIcon from "./icons/ResetStateIcon.vue";
import ResetViewIcon from "./icons/ResetViewIcon.vue";
import HitboxIcon from "./icons/HitboxIcon.vue";
import PauseIcon from "./icons/PauseIcon.vue";
import PlayIcon from "./icons/PlayIcon.vue";

import { Application, Assets, Cache, Container, Graphics, Matrix, Sprite, Texture } from "pixi.js";
import { SpineMultiplyAlphaCutoff } from "@/data/SpineMultiplyAlphaCutoff.ts";
import { Skin, Spine, type Bone } from "@esotericsoftware/spine-pixi-v8";
import { ApplicationLogSource } from "../../shared/application.ts";
import { getSkinBackgroundUrl } from "@/data/skinBackgrounds";
import { RendererLogger } from "@/utils/RendererLogger.ts";
import { PixelateFilter } from "pixi-filters/pixelate";
import { ref, onMounted, onBeforeUnmount } from "vue";
import { getModAssetUrl } from "@/data/modAssets";
import { ErrorUtils } from "@/utils/ErrorUtils";

type CensorshipType =
    | "rplus"
    | "unedited"
    | "censored"
    | "pixelated";

type FaceSkinOption = Readonly<{
    name: string;
    label: string;
}>;

type PreviewBounds = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

const CENSORSHIP_SKIN_NAMES = {
    rplus: "breast/RPlus",
    unedited: "breast/Unedited",
    censored: "breast/Censorship"
} as const;

const UNITY_MULTIPLY_ALPHA_CUTOFF = 0.1;
const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 4;
const PREVIEW_ZOOM_SENSITIVITY = 0.0015;
const PAN_DRAG_THRESHOLD = 4;
const MOSAIC_PIXEL_SIZE = 12;

const props = defineProps<{
    mod: InstalledMod;
    skin: SpineCharacterSkin;
}>();

const stageHost = ref<HTMLElement | null>(null);
const isLoading = ref(true);
const errorMessage = ref("");
const areHitboxesVisible = ref(false);
const selectedCensorshipType = ref<CensorshipType>("unedited");
const availableCensorshipTypes = ref<ReadonlySet<CensorshipType>>(new Set<CensorshipType>());
const hasDecoration1 = ref(false);
const hasDecoration2 = ref(false);
const isDecoration1Enabled = ref(false);
const isDecoration2Enabled = ref(false);
const availableFaceSkins = ref<readonly FaceSkinOption[]>([]);
const selectedFaceSkinName = ref("");
const isPanning = ref(false);
const previewZoom = ref(100);
const isAnimationPaused = ref(false);

const instanceId = crypto.randomUUID();
const skeletonAlias = `mod-preview-skeleton:${props.mod.id}:${instanceId}`;
const atlasAlias = `mod-preview-atlas:${props.mod.id}:${instanceId}`;
const backgroundLayers = props.skin.backgroundPreview?.layers ?? [];
const backgroundAliases = backgroundLayers.map((_, index) => `mod-preview-background:${props.mod.id}:${instanceId}:${index}`);
const assetAliases = [skeletonAlias, atlasAlias, ...backgroundAliases];

let application: Application | null = null;
let spine: Spine | null = null;
let resizeObserver: ResizeObserver | null = null;
let hitboxLayer: Container | null = null;
let previewScene: Container | null = null;
let spineRoot: Container | null = null;
let multiplyAlphaCutoff: SpineMultiplyAlphaCutoff | null = null;
let mosaicSpine: Spine | null = null;
let mosaicMaskLayer: Graphics | null = null;
let mosaicPixelateFilter: PixelateFilter | null = null;
let resizeFrame: number | null = null;
let skeletonCacheKey: string | null = null;
let isPostSpecialTouchState = false;
let isInteractionPlaying = false;
let assetsLoaded = false;
let disposed = false;
let fittedPreviewScale = 1;
let activePanPointerId: number | null = null;
let panStartClientX = 0;
let panStartClientY = 0;
let panLastClientX = 0;
let panLastClientY = 0;
let didDragPreview = false;

async function createPreview() {
    const host = stageHost.value;
    if (!host)
        return;

    const skeletonName = resolveAssetName(".json");
    const atlasName = resolveAssetName(".atlas");

    if (!skeletonName || !atlasName)
    {
        isLoading.value = false;
        errorMessage.value = "This mod does not contain both a Spine JSON file and an atlas file.";
        return;
    }

    try
    {
        const skeletonUrl = getModAssetUrl(props.mod.id, skeletonName);
        const atlasUrl = getModAssetUrl(props.mod.id, atlasName);

        Assets.add({ alias: skeletonAlias, src: skeletonUrl });
        Assets.add({ alias: atlasAlias, src: atlasUrl });

        for (const [index, layer] of backgroundLayers.entries())
        {
            const backgroundUrl = getSkinBackgroundUrl(layer.file);
            if (!backgroundUrl)
                throw new Error(`The preview background "${layer.file}" is unavailable.`);

            Assets.add({ alias: backgroundAliases[index], src: backgroundUrl });
        }

        await Assets.load(assetAliases);
        assetsLoaded = true;

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

        application.stage.addChild(previewScene);
        createBackgroundLayers();

        const runtimeScale = props.skin.spinePreview.scale;
        skeletonCacheKey = `${skeletonAlias}-${atlasAlias}-${runtimeScale}`;

        spineRoot = new Container();
        spineRoot.zIndex = 0;
        spineRoot.sortableChildren = true;
        spineRoot.setFromMatrix(toPixiMatrix(props.skin.spinePreview.transform));

        previewScene.addChild(spineRoot);

        spine = Spine.from({
            skeleton: skeletonAlias,
            atlas: atlasAlias,
            scale: runtimeScale,
            autoUpdate: true,
            ticker: application.ticker
        });

        mosaicSpine = Spine.from({
            skeleton: skeletonAlias,
            atlas: atlasAlias,
            scale: runtimeScale,
            autoUpdate: true,
            ticker: application.ticker
        });

        spine.zIndex = 0;
        mosaicSpine.zIndex = 1;

        mosaicMaskLayer = new Graphics();
        mosaicMaskLayer.zIndex = 2;
        mosaicMaskLayer.eventMode = "none";

        mosaicPixelateFilter = new PixelateFilter(MOSAIC_PIXEL_SIZE);
        mosaicSpine.filters = [mosaicPixelateFilter];
        mosaicSpine.mask = mosaicMaskLayer;

        spineRoot.addChild(spine);
        spineRoot.addChild(mosaicSpine);
        spineRoot.addChild(mosaicMaskLayer);

        multiplyAlphaCutoff = new SpineMultiplyAlphaCutoff(UNITY_MULTIPLY_ALPHA_CUTOFF);
        multiplyAlphaCutoff.apply(spine);

        initializeCensorshipTypes();
        initializeDecorationOptions();
        initializeFaceSkins();
        applySkinComposition();

        const idleAnimation = props.skin.spinePreview.animations.idle;
        if (!spine.skeleton.data.findAnimation(idleAnimation))
            throw new Error(`The idle animation "${idleAnimation}" was not found.`);

        setPreviewAnimation(idleAnimation, true);

        for (const runtime of getRuntimeSpines())
            runtime.update(0);

        application.ticker.add(updateSpineMosaicMasks);

        updateMosaicOverlayVisibility();
        createHitboxLayer();
        fitPreview();

        resizeObserver = new ResizeObserver(schedulePreviewFit);
        resizeObserver.observe(host);

        isLoading.value = false;
    }
    catch (error)
    {
        if (!disposed)
        {
            errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The Spine preview could not be loaded.");
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

    if (application)
    {
        application.ticker.remove(updateSpineMosaicMasks);

        setPreviewChildAttached(spineRoot, mosaicSpine, true);
        setPreviewChildAttached(spineRoot, mosaicMaskLayer, true);

        const pixelateFilter = mosaicPixelateFilter;

        application.stage.destroy({ children: true });
        pixelateFilter?.destroy();
        application.destroy({ removeView: false }, false);

        application = null;
        previewScene = null;
        spineRoot = null;
        spine = null;
        mosaicSpine = null;
        mosaicMaskLayer = null;
        mosaicPixelateFilter = null;
        hitboxLayer = null;

        multiplyAlphaCutoff?.destroy();
        multiplyAlphaCutoff = null;
    }

    stageHost.value?.replaceChildren();

    if (skeletonCacheKey)
    {
        Cache.remove(skeletonCacheKey);
        skeletonCacheKey = null;
    }

    if (assetsLoaded)
    {
        assetsLoaded = false;

        try
        {
            await Assets.unload(assetAliases);
        }
        catch
        {}
    }
}

function assembleGameSkin(target: Spine) {
    const previewData = props.skin.spinePreview;
    const skeletonData = target.skeleton.data;
    const compositeSkin = new Skin("lorplus-preview");

    if (!addSkinIfPresent(target, compositeSkin, previewData.baseSkin))
        throw new Error(`The base Spine skin "${previewData.baseSkin}" was not found.`);

    addSkinIfPresent(target, compositeSkin, resolveCensorshipSkinName(selectedCensorshipType.value));

    if (selectedFaceSkinName.value)
    {
        const selectedFaceSkin = skeletonData.findSkin(selectedFaceSkinName.value);
        if (selectedFaceSkin)
            compositeSkin.addSkin(selectedFaceSkin);
    }

    if (isDecoration1Enabled.value)
    {
        for (const candidate of skeletonData.skins)
        {
            if (candidate.name.includes("decorations/"))
                compositeSkin.addSkin(candidate);
        }
    }

    if (isDecoration2Enabled.value)
    {
        for (const candidate of skeletonData.skins)
        {
            if (candidate.name.includes("decorations2/"))
                compositeSkin.addSkin(candidate);
        }
    }

    target.skeleton.setSkin(compositeSkin);
    target.skeleton.setSlotsToSetupPose();
}

function addSkinIfPresent(target: Spine, compositeSkin: Skin, skinName: string): boolean {
    const foundSkin = target.skeleton.data.findSkin(skinName);
    if (!foundSkin)
        return false;

    compositeSkin.addSkin(foundSkin);
    return true;
}

function initializeCensorshipTypes() {
    if (!spine)
        return;

    const detectedTypes = new Set<CensorshipType>();

    if (spine.skeleton.data.findSkin(CENSORSHIP_SKIN_NAMES.rplus))
        detectedTypes.add("rplus");
    if (spine.skeleton.data.findSkin(CENSORSHIP_SKIN_NAMES.unedited))
        detectedTypes.add("unedited");
    if (spine.skeleton.data.findSkin(CENSORSHIP_SKIN_NAMES.censored))
        detectedTypes.add("censored");
    if (hasMappedMosaicCensorship())
        detectedTypes.add("pixelated");

    availableCensorshipTypes.value = detectedTypes;

    const preferenceOrder: readonly CensorshipType[] = props.skin.isRPlusSkin
        ? ["rplus", "unedited", "censored", "pixelated"]
        : ["unedited", "censored", "rplus", "pixelated"];

    selectedCensorshipType.value = preferenceOrder.find((type) => detectedTypes.has(type)) ?? "unedited";
}

function applySelectedCensorship() {
    if (!spine || !availableCensorshipTypes.value.has(selectedCensorshipType.value))
        return;

    applySkinComposition();
}

function initializeDecorationOptions() {
    if (!spine)
        return;

    const skeletonSkins = spine.skeleton.data.skins;

    hasDecoration1.value = skeletonSkins.some((candidate) => candidate.name.includes("decorations/"));
    hasDecoration2.value = skeletonSkins.some((candidate) => candidate.name.includes("decorations2/"));
    isDecoration1Enabled.value = hasDecoration1.value && props.skin.spinePreview.defaultParts;
    isDecoration2Enabled.value = hasDecoration2.value && props.skin.spinePreview.defaultParts2;
}

function toggleDecoration(group: 1 | 2) {
    if (group === 1)
    {
        if (!hasDecoration1.value)
            return;

        isDecoration1Enabled.value = !isDecoration1Enabled.value;
    }
    else
    {
        if (!hasDecoration2.value)
            return;

        isDecoration2Enabled.value = !isDecoration2Enabled.value;
    }

    applySkinComposition();
}

function initializeFaceSkins() {
    if (!spine)
        return;

    const faceSkins = spine.skeleton.data.skins
        .filter((candidate) => candidate.name.toLowerCase().startsWith("face/"))
        .map((candidate) => ({
            name: candidate.name,
            label: formatFaceSkinLabel(candidate.name)
        }))
        .sort((left, right) => {
            const leftIsIdle = /idle$/i.test(left.name);
            const rightIsIdle = /idle$/i.test(right.name);

            if (leftIsIdle !== rightIsIdle)
                return leftIsIdle ? -1 : 1;

            return left.label.localeCompare(right.label);
        });

    availableFaceSkins.value = faceSkins;
    selectedFaceSkinName.value = faceSkins.find((candidate) => /idle$/i.test(candidate.name))?.name ?? faceSkins[0].name ?? "";
}

function applySelectedFaceSkin() {
    if (!spine || !availableFaceSkins.value.some((candidate) => candidate.name === selectedFaceSkinName.value))
        return;

    applySkinComposition();
}

function createBackgroundLayers() {
    if (!previewScene)
        return;

    for (const [index, layer] of backgroundLayers.entries())
    {
        const texture = Assets.get<Texture>(backgroundAliases[index]);
        if (!texture)
            throw new Error(`The preview background "${layer.file}" could not be loaded.`);

        const layerRoot = new Container();
        layerRoot.zIndex = layer.sortingOrder;
        layerRoot.setFromMatrix(toPixiMatrix(layer.transform));

        const sprite = new Sprite(texture);
        sprite.anchor.set(layer.pivot.x, 1 - layer.pivot.y);
        sprite.width = layer.width;
        sprite.height = layer.height;

        layerRoot.addChild(sprite);
        previewScene.addChild(layerRoot);
    }
}

function applySkinComposition() {
    for (const runtime of getRuntimeSpines())
    {
        assembleGameSkin(runtime);
        runtime.update(0);
    }

    updateMosaicOverlayVisibility();
}

function fitPreview() {
    if (!application || !previewScene || !spine)
        return;

    const screenWidth = application.screen.width;
    const screenHeight = application.screen.height;
    const camera = props.skin.backgroundPreview?.camera;

    if (camera)
    {
        const cameraBounds = getTransformedSpriteBounds(camera);
        if (cameraBounds.width <= 0 || cameraBounds.height <= 0)
            return;

        const viewportScale = Math.max(screenWidth / cameraBounds.width, screenHeight / cameraBounds.height) / camera.zoom;
        const cameraCenterX = cameraBounds.x + cameraBounds.width / 2;
        const cameraCenterY = cameraBounds.y + cameraBounds.height / 2;

        setFittedPreviewView(
            viewportScale,
            screenWidth / 2 - cameraCenterX * viewportScale,
            screenHeight / 2 - cameraCenterY * viewportScale
        );
        return;
    }

    const bounds = getTransformedRectangleBounds(
        spine.bounds.x,
        spine.bounds.y,
        spine.bounds.width,
        spine.bounds.height,
        toPixiMatrix(props.skin.spinePreview.transform)
    );

    if (bounds.width <= 0 || bounds.height <= 0)
        return;

    const padding = Math.min(64, screenWidth * 0.06, screenHeight * 0.06);
    const availableWidth = Math.max(screenWidth - padding * 2, 1);
    const availableHeight = Math.max(screenHeight - padding * 2, 1);
    const viewportScale = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);

    setFittedPreviewView(
        viewportScale,
        screenWidth / 2 - (bounds.x + bounds.width / 2) * viewportScale,
        screenHeight / 2 - (bounds.y + bounds.height / 2) * viewportScale
    );
}

function createHitboxLayer() {
    if (!spineRoot)
        return;

    hitboxLayer = new Container();
    hitboxLayer.alpha = areHitboxesVisible.value ? 1 : 0;

    const previewData = props.skin.spinePreview;
    hitboxLayer.addChild(createHitboxGraphic(previewData.hitboxes.touch, "touch"));

    for (const specialTouchHitbox of previewData.hitboxes.specialTouch)
        hitboxLayer.addChild(createHitboxGraphic(specialTouchHitbox, "special"));

    spineRoot.addChild(hitboxLayer);
}

function createHitboxGraphic(hitbox: SpineHitbox, kind: "touch" | "special"): Graphics {
    const color = kind === "special" ? 0xe5a06d : 0x91b8cf;
    const fillAlpha = kind === "special" ? 0.14 : 0.09;

    const graphic = new Graphics()
        .rect(-hitbox.width / 2, -hitbox.height / 2, hitbox.width, hitbox.height)
        .fill({ color, alpha: fillAlpha })
        .stroke({ color, alpha: 0.95, width: 0.065 });

    graphic.position.set(hitbox.x, -hitbox.y);
    graphic.rotation = -hitbox.rotation * Math.PI / 180;
    graphic.eventMode = "static";
    graphic.cursor = "pointer";

    graphic.on("pointertap", (event) => {
        event.stopPropagation();

        if (didDragPreview)
            return;

        playInteractionAnimation(kind);
    });

    return graphic;
}

function playInteractionAnimation(kind: "touch" | "special") {
    if (!spine || isInteractionPlaying)
        return;

    const animations = props.skin.spinePreview.animations;
    const postAnimations = animations.postSpecialTouch;

    const currentAnimations = isPostSpecialTouchState && postAnimations
        ? postAnimations
        : animations;

    const animationName = kind === "touch"
        ? currentAnimations.touch
        : currentAnimations.specialTouch;

    if (!animationName)
        return;

    if (!spine.skeleton.data.findAnimation(animationName))
    {
        RendererLogger.warning(ApplicationLogSource.modLibrary, `Spine preview animation "${animationName}" was not found.`);
        return;
    }

    let nextIdleAnimation = currentAnimations.idle;
    let entersPostSpecialTouchState = false;

    if (kind === "special" && !isPostSpecialTouchState && postAnimations)
    {
        entersPostSpecialTouchState = true;
        nextIdleAnimation = postAnimations.idle;
    }

    if (!spine.skeleton.data.findAnimation(nextIdleAnimation))
    {
        RendererLogger.warning(ApplicationLogSource.modLibrary, `Spine preview idle animation "${nextIdleAnimation}" was not found.`);
        return;
    }

    isInteractionPlaying = true;
    const entry = setPreviewAnimation(animationName, false);

    entry.listener = {
        complete: () => {
            if (!spine || disposed)
                return;

            if (entersPostSpecialTouchState)
                isPostSpecialTouchState = true;

            setPreviewAnimation(nextIdleAnimation, true);
            isInteractionPlaying = false;
        },
        interrupt: () => {
            isInteractionPlaying = false;
        }
    };
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

function getTransformedSpriteBounds(sprite: PreviewSprite): PreviewBounds {
    const left = -sprite.pivot.x * sprite.width;
    const top = -(1 - sprite.pivot.y) * sprite.height;

    return getTransformedRectangleBounds(left, top, sprite.width, sprite.height, toPixiMatrix(sprite.transform));
}

function getTransformedRectangleBounds(x: number, y: number, width: number, height: number, transform: Matrix): PreviewBounds {
    const corners = [
        transformPoint(transform, x, y),
        transformPoint(transform, x + width, y),
        transformPoint(transform, x, y + height),
        transformPoint(transform, x + width, y + height)
    ];

    const minimumX = Math.min(...corners.map(point => point.x));
    const maximumX = Math.max(...corners.map(point => point.x));
    const minimumY = Math.min(...corners.map(point => point.y));
    const maximumY = Math.max(...corners.map(point => point.y));

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

function setFittedPreviewView(scale: number, x: number, y: number) {
    if (!previewScene)
        return;

    fittedPreviewScale = scale;
    previewScene.scale.set(scale);
    previewScene.position.set(x, y);
    previewZoom.value = 100;
}

function getRuntimeSpines(): Spine[] {
    const runtimes: Spine[] = [];

    if (spine)
        runtimes.push(spine);
    if (mosaicSpine)
        runtimes.push(mosaicSpine);

    return runtimes;
}

function setPreviewAnimation(animationName: string, loop: boolean) {
    if (!spine)
        throw new Error("The Spine preview is unavailable.");

    const entry = spine.state.setAnimation(0, animationName, loop);
    mosaicSpine?.state.setAnimation(0, animationName, loop);

    return entry;
}

function setPreviewChildAttached(parent: Container | null, child: Container | null, attached: boolean) {
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

function updateMosaicOverlayVisibility() {
    const shouldShow = selectedCensorshipType.value === "pixelated" && hasMappedMosaicCensorship();

    setPreviewChildAttached(spineRoot, mosaicSpine, shouldShow);
    setPreviewChildAttached(spineRoot, mosaicMaskLayer, shouldShow);

    if (shouldShow)
        updateSpineMosaicMasks();
}

function updateSpineMosaicMasks() {
    if (selectedCensorshipType.value !== "pixelated" || !mosaicSpine || !mosaicMaskLayer || !mosaicMaskLayer.parent)
        return;

    mosaicMaskLayer.clear();
    let hasGeometry = false;

    for (const mask of props.skin.spinePreview.mosaicMasks)
    {
        const bone = mosaicSpine.skeleton.findBone(mask.boneName);
        if (!bone)
            continue;

        const left = -mask.pivot.x * mask.width;
        const right = left + mask.width;
        const bottom = -mask.pivot.y * mask.height;
        const top = bottom + mask.height;

        const corners = [
            transformMosaicPoint(mask.transform, left, bottom),
            transformMosaicPoint(mask.transform, right, bottom),
            transformMosaicPoint(mask.transform, right, top),
            transformMosaicPoint(mask.transform, left, top)
        ];

        const polygon: number[] = [];

        for (const point of corners)
        {
            const worldPoint = transformThroughSkeletonUtilityHierarchy(point, bone);
            polygon.push(worldPoint.x, -worldPoint.y);
        }

        mosaicMaskLayer.poly(polygon, true);
        hasGeometry = true;
    }

    if (hasGeometry)
        mosaicMaskLayer.fill({ color: 0xffffff });
}

function transformThroughSkeletonUtilityHierarchy(point: Readonly<{ x: number; y: number }>, bone: Bone) {
    let x = point.x;
    let y = point.y;
    let currentBone: Bone | null = bone;

    while (currentBone)
    {
        const rotation = currentBone.arotation * Math.PI / 180;
        const cosine = Math.cos(rotation);
        const sine = Math.sin(rotation);

        const scaledX = x * currentBone.ascaleX;
        const scaledY = y * currentBone.ascaleY;

        x = currentBone.ax + scaledX * cosine - scaledY * sine;
        y = currentBone.ay + scaledX * sine + scaledY * cosine;

        currentBone = currentBone.parent;
    }

    return { x, y };
}

function transformMosaicPoint(transform: PreviewTransform, x: number, y: number) {
    return {
        x: transform.a * x + transform.c * y + transform.tx,
        y: transform.b * x + transform.d * y + transform.ty
    };
}

function hasMappedMosaicCensorship(): boolean {
    if (!spine || props.skin.spinePreview.mosaicMasks.length === 0)
        return false;
    if (!spine.skeleton.data.findSkin(CENSORSHIP_SKIN_NAMES.rplus))
        return false;

    return props.skin.spinePreview.mosaicMasks.every((mask) => spine?.skeleton.findBone(mask.boneName) !== null);
}

function resolveCensorshipSkinName(type: CensorshipType): string {
    if (type === "pixelated")
        return CENSORSHIP_SKIN_NAMES.rplus;

    return CENSORSHIP_SKIN_NAMES[type];
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
        Math.max(MIN_PREVIEW_ZOOM, currentZoom * Math.exp(-normalizedDelta * PREVIEW_ZOOM_SENSITIVITY))
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
    if (!previewScene ||activePanPointerId !== null || (event.button !== 0 && event.button !== 1))
        return;

    activePanPointerId = event.pointerId;
    panStartClientX = event.clientX;
    panStartClientY = event.clientY;
    panLastClientX = event.clientX;
    panLastClientY = event.clientY;
    didDragPreview = false;
    isPanning.value = false;

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
        target.setPointerCapture(event.pointerId);
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

function resolveAssetName(extension: ".json" | ".atlas"): string | null {
    const expectedName = props.skin.assets.find((assetName) => assetName.toLowerCase().endsWith(extension));
    if (expectedName)
        return props.mod.assetNames.find((assetName) => assetName.toLowerCase() === expectedName.toLowerCase()) ?? expectedName;

    return props.mod.assetNames.find((assetName) => assetName.toLowerCase().endsWith(extension)) ?? null;
}

function toggleHitboxVisibility() {
    areHitboxesVisible.value = !areHitboxesVisible.value;

    if (hitboxLayer)
        hitboxLayer.alpha = areHitboxesVisible.value ? 1 : 0;
}

function toggleAnimationPlayback() {
    if (!spine)
        return;

    isAnimationPaused.value = !isAnimationPaused.value;
    const timeScale = isAnimationPaused.value ? 0 : 1;

    for (const runtime of getRuntimeSpines())
        runtime.state.timeScale = timeScale;
}

function resetCharacterState() {
    if (!spine)
        return;

    isAnimationPaused.value = false;
    isPostSpecialTouchState = false;
    isInteractionPlaying = false;

    for (const runtime of getRuntimeSpines())
    {
        runtime.state.timeScale = 1;
        runtime.state.clearTracks();
        runtime.skeleton.setToSetupPose();

        assembleGameSkin(runtime);
    }

    setPreviewAnimation(props.skin.spinePreview.animations.idle, true);

    for (const runtime of getRuntimeSpines())
        runtime.update(0);

    updateMosaicOverlayVisibility();
}

function formatFaceSkinLabel(skinName: string): string {
    const finalPathPart = skinName.split("/").pop() ?? skinName;
    const finalUnderscore = finalPathPart.lastIndexOf("_");

    const rawLabel = finalUnderscore >= 0
        ? finalPathPart.slice(finalUnderscore + 1)
        : finalPathPart;

    return rawLabel
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z])(\d+)/g, "$1 $2")
        .replaceAll("_", " ");
}

onMounted(createPreview);

onBeforeUnmount(() => {
    disposed = true;
    void destroyPreview();
});
</script>

<template>
    <section
        class="spine-preview"
        :aria-busy="isLoading"
        :aria-label="`Spine preview for ${mod.directoryName}`"
    >
        <div
            ref="stageHost"
            class="spine-preview-canvas"
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

        <div v-if="!isLoading && !errorMessage" class="spine-preview-controls">
            <label class="spine-preview-censorship-control">
                <span>Censorship</span>

                <span class="spine-preview-select-wrap">
                    <select
                        v-model="selectedCensorshipType"
                        aria-label="Censorship type"
                        @change="applySelectedCensorship"
                    >
                        <option value="rplus" :disabled="!availableCensorshipTypes.has('rplus')">
                            R+{{ availableCensorshipTypes.has("rplus") ? "" : " (not available)" }}
                        </option>
                        <option value="unedited" :disabled="!availableCensorshipTypes.has('unedited')">
                            Unedited{{ availableCensorshipTypes.has("unedited") ? "" : " (not available)" }}
                        </option>
                        <option value="censored" :disabled="!availableCensorshipTypes.has('censored')">
                            Censored{{ availableCensorshipTypes.has("censored") ? "" : " (not available)" }}
                        </option>
                        <option value="pixelated" :disabled="!availableCensorshipTypes.has('pixelated')">
                            Pixelated{{ availableCensorshipTypes.has("pixelated") ? "" : " (not available)" }}
                        </option>
                    </select>

                    <span class="spine-preview-select-caret" aria-hidden="true"></span>
                </span>
            </label>

            <label
                v-if="availableFaceSkins.length > 0"
                class="spine-preview-face-control"
            >
                <span>Face</span>

                <span class="spine-preview-select-wrap">
                    <select
                        v-model="selectedFaceSkinName"
                        :disabled="availableFaceSkins.length < 2"
                        aria-label="Face skin"
                        @change="applySelectedFaceSkin"
                    >
                        <option
                            v-for="faceSkin in availableFaceSkins"
                            :key="faceSkin.name"
                            :value="faceSkin.name"
                            :title="faceSkin.name"
                        >
                            {{ faceSkin.label }}
                        </option>
                    </select>

                    <span class="spine-preview-select-caret" aria-hidden="true"></span>
                </span>
            </label>

            <div
                v-if="hasDecoration1 || hasDecoration2"
                class="spine-preview-decoration-control"
            >
                <span>Decorations</span>

                <div class="spine-preview-decoration-buttons">
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

            <div class="spine-preview-animation-control">
                <span>Animation</span>

                <div class="spine-preview-animation-buttons">
                    <button
                        class="spine-preview-tool-button"
                        :class="{ 'is-active': isAnimationPaused }"
                        type="button"
                        :aria-pressed="isAnimationPaused"
                        :aria-label="isAnimationPaused ? 'Resume animation' : 'Pause animation'"
                        :title="isAnimationPaused ? 'Resume animation' : 'Pause animation'"
                        @click="toggleAnimationPlayback"
                    >
                        <PlayIcon v-if="isAnimationPaused" />
                        <PauseIcon v-else />
                    </button>

                    <button
                        class="spine-preview-tool-button"
                        type="button"
                        aria-label="Reset character state"
                        title="Reset character to its initial state"
                        @click="resetCharacterState"
                    >
                        <ResetStateIcon />
                    </button>
                </div>
            </div>

            <button
                class="spine-preview-tool-button spine-preview-hitbox-toggle"
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

        <div v-if="!isLoading && !errorMessage" class="spine-preview-navigation">
            <span class="spine-preview-navigation-hint">Drag to pan · Scroll to zoom</span>
            <span class="spine-preview-zoom-value">{{ previewZoom }}%</span>

            <button
                class="spine-preview-reset-view"
                type="button"
                title="Reset zoom and position"
                aria-label="Reset zoom and position"
                @click="resetPreviewView"
            >
                <ResetViewIcon />
            </button>
        </div>

        <div v-if="isLoading" class="spine-preview-state" role="status">
            <span class="spine-preview-spinner" aria-hidden="true"></span>
            <strong>Loading preview</strong>
            <p>Preparing the skeleton, atlas and textures.</p>
        </div>

        <div v-else-if="errorMessage" class="spine-preview-state is-error" role="alert">
            <span class="spine-preview-error-mark" aria-hidden="true">!</span>
            <strong>Preview unavailable</strong>
            <p>{{ errorMessage }}</p>
        </div>
    </section>
</template>

<style scoped>
.spine-preview {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.spine-preview-canvas {
    width: 100%;
    height: 100%;
    opacity: 1;
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: opacity 150ms ease;
}

.spine-preview-canvas.is-panning,
.spine-preview-canvas.is-panning :deep(canvas) {
    cursor: grabbing !important;
}

.spine-preview-canvas.is-hidden {
    opacity: 0;
}

.spine-preview-canvas :deep(canvas) {
    display: block;
    width: 100%;
    height: 100%;
}

.spine-preview-controls {
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

.spine-preview-censorship-control,
.spine-preview-face-control {
    display: flex;
    min-width: 158px;
    flex-direction: column;
    gap: 5px;
    color: #9ca39d;
    font-size: 11px;
    font-weight: 700;
}

.spine-preview-face-control {
    width: 180px;
}

.spine-preview-decoration-control {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #9ca39d;
    font-size: 11px;
    font-weight: 700;
}

.spine-preview-animation-control {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #9ca39d;
    font-size: 11px;
    font-weight: 700;
}

.spine-preview-animation-buttons {
    display: flex;
    gap: 5px;
}

.spine-preview-decoration-buttons {
    display: flex;
    gap: 5px;
}

.spine-preview-decoration-buttons button {
    display: grid;
    width: 42px;
    height: 42px;
    padding: 0;
    place-items: center;
    border: 1px solid #303632;
    border-radius: 7px;
    color: #aeb3ad;
    background: rgba(18, 22, 19, 0.94);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.24);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
}

.spine-preview-decoration-buttons button:hover {
    color: #f2eee5;
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.spine-preview-decoration-buttons button.is-active {
    color: #b9ddf2;
    border-color: #50758a;
    background: rgba(20, 39, 49, 0.96);
}

.spine-preview-decoration-buttons button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.spine-preview-select-wrap {
    position: relative;
    display: block;
}

.spine-preview-select-wrap select {
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

.spine-preview-select-wrap select:hover {
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.spine-preview-select-wrap select:disabled {
    color: #898f89;
    cursor: default;
}

.spine-preview-select-wrap select:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.spine-preview-select-wrap select option:disabled {
    color: #6f756f;
}

.spine-preview-select-caret {
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

.spine-preview-tool-button {
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
    cursor: pointer;
}

.spine-preview-tool-button:hover {
    color: #f2eee5;
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.spine-preview-tool-button.is-active {
    color: #b9ddf2;
    border-color: #50758a;
    background: rgba(20, 39, 49, 0.96);
}

.spine-preview-tool-button:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.spine-preview-tool-button svg {
    width: 21px;
    height: 21px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.spine-preview-navigation {
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

.spine-preview-navigation-hint {
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}

.spine-preview-zoom-value {
    min-width: 42px;
    color: #d9d7cf;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    text-align: right;
}

.spine-preview-reset-view {
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

.spine-preview-reset-view:hover {
    color: #f2eee5;
    background: #252b27;
}

.spine-preview-reset-view:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.spine-preview-reset-view svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.spine-preview-state {
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

.spine-preview-state strong,
.spine-preview-state p {
    margin: 0;
}

.spine-preview-state strong {
    color: #dedbd3;
    font-size: 15px;
}

.spine-preview-state p {
    max-width: 480px;
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.5;
}

.spine-preview-spinner {
    width: 34px;
    height: 34px;
    margin-bottom: 16px;
    border: 3px solid #263137;
    border-top-color: #91b8cf;
    border-radius: 50%;
    animation: spine-preview-spin 750ms linear infinite;
}

.spine-preview-error-mark {
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

.spine-preview-state.is-error p {
    color: #d49b97;
}

@keyframes spine-preview-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .spine-preview-spinner {
        animation-duration: 1.5s;
    }
}

@media (max-width: 760px) {
    .spine-preview-navigation-hint {
        display: none;
    }
}
</style>
