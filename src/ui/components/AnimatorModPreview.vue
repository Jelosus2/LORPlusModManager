<script setup lang="ts">
import type { AnimatorCharacterSkin } from "../../shared/characters.ts";
import type { InstalledMod } from "../../shared/mod";
import type { Texture, Ticker } from "pixi.js";

import ResetStateIcon from "./icons/ResetStateIcon.vue";
import ResetViewIcon from "./icons/ResetViewIcon.vue";
import HitboxIcon from "./icons/HitboxIcon.vue";
import PauseIcon from "./icons/PauseIcon.vue";
import PlayIcon from "./icons/PlayIcon.vue";

import { AnimatorPreviewInteractionLayer } from "@/animator/AnimatorPreviewInteractionLayer";
import { AnimatorPreviewMosaicLayer } from "@/animator/AnimatorPreviewMosaicLayer";
import { AnimatorRuntimePackage } from "@/animator/AnimatorRuntimePackage";
import { usePreviewViewport } from "@/composables/usePreviewViewport";
import { AnimatorPixiScene } from "@/animator/AnimatorPixiScene";
import { ApplicationLogSource } from "../../shared/application";
import { RendererLogger } from "@/utils/RendererLogger";
import { Application, Assets, Cache } from "pixi.js";
import { getModAssetUrl } from "@/data/modAssets";
import { ref, watch, onBeforeUnmount } from "vue";
import { ErrorUtils } from "@/utils/ErrorUtils";

type RuntimeSummary = Readonly<{
    formatVersion: number;
    transforms: number;
    gameObjects: number;
    controllers: number;
    clips: number;
    meshes: number;
    sprites: number;
    skinnedRenderers: number;
    spriteRenderers: number;
    textures: number;
    visibleDeformers: number;
}>;

type CensorshipType =
    | "rplus"
    | "unedited"
    | "pixelated";

const props = defineProps<{
    mod: InstalledMod;
    skin: AnimatorCharacterSkin;
}>();

const stageHost = ref<HTMLElement | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");
const runtimeSummary = ref<RuntimeSummary | null>(null);
const diagnostics = ref<readonly string[]>([]);
const isAnimationPaused = ref(false);
const areHitboxesVisible = ref(false);
const hasInteractionHitboxes = ref(false);
const selectedCensorshipType = ref<CensorshipType>("unedited");
const availableCensorshipTypes = ref<ReadonlySet<CensorshipType>>(new Set<CensorshipType>());

const instanceId = crypto.randomUUID();
const registeredAliases: string[] = [];

let application: Application | null = null;
let pixiScene: AnimatorPixiScene | null = null;
let resizeObserver: ResizeObserver | null = null;
let interactionLayer: AnimatorPreviewInteractionLayer | null = null;
let mosaicLayer: AnimatorPreviewMosaicLayer | null = null;
let resizeFrame: number | null = null;
let loadController: AbortController | null = null;
let loadGeneration = 0;
let frameFailed = false;
let disposed = false;

const {
    isPanning,
    didDragPreview,
    previewZoom,
    fitPreview,
    resetPreviewView,
    handlePreviewWheel,
    startPreviewPan,
    movePreviewPan,
    finishPreviewPan,
    resetPointerInteraction
} = usePreviewViewport({
    getApplication: () => application,
    getHost: () => stageHost.value,
    getScene: () => pixiScene?.root ?? null,
    getFit: () => {
        const bounds = pixiScene?.getVisibleBounds();

        return bounds
            ? { bounds, padding: 72 }
            : null;
    },
    scaleYDirection: -1
});

watch(() => props.mod.id, () => {
    void loadPreview()
}, { immediate: true });

async function loadPreview() {
    const generation = ++loadGeneration;

    loadController?.abort();
    loadController = null;

    isLoading.value = true;
    errorMessage.value = "";
    runtimeSummary.value = null;
    diagnostics.value = [];
    selectedCensorshipType.value = "unedited";
    availableCensorshipTypes.value = new Set<CensorshipType>();
    frameFailed = false;

    areHitboxesVisible.value = false;
    hasInteractionHitboxes.value = false;

    await destroyRenderer();

    if (disposed || generation !== loadGeneration)
        return;

    const controller = new AbortController();
    loadController = controller;

    try
    {
        const host = stageHost.value;
        if (!host)
            throw new Error("The Animator preview surface is unavailable.");

        const preparation = await window.app.prepareAnimatorModPreview(props.mod.id);

        requireCurrentLoad(generation, controller.signal);

        const loadedPackage = await AnimatorRuntimePackage.load(preparation, controller.signal);

        requireCurrentLoad(generation, controller.signal);

        const texturesById = await loadRuntimeTextures(loadedPackage, generation, controller.signal);

        requireCurrentLoad(generation, controller.signal);

        const createdApplication = new Application();

        await createdApplication.init({
            resizeTo: host,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            preference: "webgl",
            powerPreference: "high-performance"
        });

        if (disposed || controller.signal.aborted || generation !== loadGeneration)
        {
            createdApplication.destroy({ removeView: true }, { children: true });
            throw createAbortError();
        }

        application = createdApplication;
        pixiScene = new AnimatorPixiScene(loadedPackage, texturesById);
        mosaicLayer = new AnimatorPreviewMosaicLayer(loadedPackage, texturesById);
        interactionLayer = new AnimatorPreviewInteractionLayer(loadedPackage, {
            wasDragged: () => didDragPreview.value,
            onTriggered: () => {
                isAnimationPaused.value = false;
            }
        });

        pixiScene.root.addChild(mosaicLayer.root);

        initializeCensorshipTypes(loadedPackage);
        applySelectedCensorship();

        hasInteractionHitboxes.value = interactionLayer.hasHitboxes;
        interactionLayer.setOutlinesVisible(areHitboxesVisible.value);

        pixiScene.root.addChild(interactionLayer.root);

        host.replaceChildren(createdApplication.canvas);
        createdApplication.stage.addChild(pixiScene.root);

        const initialFrame = pixiScene.reset();

        mosaicLayer.update();
        interactionLayer.update();
        updateDiagnostics(initialFrame.diagnostics);

        fitPreview();

        createdApplication.ticker.add(updateAnimatorFrame);

        resizeObserver = new ResizeObserver(schedulePreviewFit);
        resizeObserver.observe(host);

        const scene = loadedPackage.manifest.scene;

        runtimeSummary.value = {
            formatVersion: loadedPackage.manifest.formatVersion,
            transforms: scene.transforms.length,
            gameObjects: scene.gameObjects.length,
            controllers: loadedPackage.manifest.controllers.length,
            clips: loadedPackage.manifest.animations.clips.length,
            meshes: scene.meshes.length,
            sprites: scene.sprites.length,
            skinnedRenderers: scene.skinnedMeshRenderers.length,
            spriteRenderers: scene.spriteRenderers.length,
            textures: loadedPackage.manifest.textures.length,
            visibleDeformers: [...loadedPackage.meshDeformer.meshes.values()].filter((mesh) => mesh.visible).length
        };

        RendererLogger.info(
            ApplicationLogSource.modLibrary,
            `Animator preview renderer initialized for "${props.mod.directoryName}".`,
            runtimeSummary.value
        );
    }
    catch (error)
    {
        if (isAbortError(error) || generation !== loadGeneration)
            return;

        errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The Animator preview could not be loaded.");

        RendererLogger.error(ApplicationLogSource.modLibrary, `Could not initialize the Animator preview for "${props.mod.directoryName}".`, error);

        await destroyRenderer();
    }
    finally
    {
        if (generation === loadGeneration)
        {
            loadController = null;
            isLoading.value = false;
        }
    }
}

async function destroyRenderer() {
    resetPointerInteraction();
    isAnimationPaused.value = false;

    resizeObserver?.disconnect();
    resizeObserver = null;

    if (resizeFrame !== null)
    {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
    }

    application?.ticker.remove(updateAnimatorFrame);

    if (interactionLayer)
    {
        interactionLayer.destroy();
        interactionLayer = null;
    }

    hasInteractionHitboxes.value = false;

    if (mosaicLayer)
    {
        mosaicLayer.destroy();
        mosaicLayer = null;
    }

    if (pixiScene)
    {
        pixiScene.root.parent?.removeChild(pixiScene.root);
        pixiScene.destroy();
        pixiScene = null;
    }

    const currentApplication = application;
    application = null;

    currentApplication?.destroy({ removeView: true }, { children: true });
    frameFailed = false;

    stageHost.value?.replaceChildren();

    const aliases = registeredAliases.splice(0, registeredAliases.length);
    await Promise.allSettled(aliases.filter((alias) => Cache.has(alias)).map((alias) => Assets.unload(alias)));
}

async function loadRuntimeTextures(loadedPackage: AnimatorRuntimePackage, generation: number, signal: AbortSignal): Promise<ReadonlyMap<string, Texture>> {
    const aliasesByTextureId = new Map<string, string>();
    const modAssetsByName = new Map<string, string>();

    for (const assetName of props.mod.assetNames)
        modAssetsByName.set(assetName.toLocaleLowerCase("en-US"), assetName);

    for (const [index, texture] of loadedPackage.manifest.textures.entries())
    {
        const alias = [
            "animator-preview-texture",
            props.mod.id,
            instanceId,
            generation,
            index
        ].join(":");

        const modAssetName = modAssetsByName.get(texture.assetName.toLocaleLowerCase("en-US"));

        const url = modAssetName
            ? getModAssetUrl(props.mod.id, modAssetName)
            : loadedPackage.requireTextureUrl(texture.id);

        Assets.add({ alias, src: url });

        registeredAliases.push(alias);
        aliasesByTextureId.set(texture.id, alias);
    }

    if (registeredAliases.length > 0)
        await Assets.load(registeredAliases);

    requireCurrentLoad(generation, signal);

    const texturesById = new Map<string, Texture>();

    for (const texture of loadedPackage.manifest.textures)
    {
        const alias = aliasesByTextureId.get(texture.id);
        const loadedTexture = alias
            ? Assets.get<Texture>(alias)
            : undefined;

        if (!loadedTexture)
            throw new Error(`Animator texture "${texture.assetName}" could not be loaded.`);

        texturesById.set(texture.id, loadedTexture);
    }

    return texturesById;
}

function updateAnimatorFrame(ticker: Ticker) {
    if (!pixiScene || frameFailed || isAnimationPaused.value)
        return;

    try
    {
        const deltaSeconds = Math.min(Math.max(ticker.deltaMS / 1000, 0), 0.05);
        const frame = pixiScene.advance(deltaSeconds);

        mosaicLayer?.update();
        interactionLayer?.update();
        updateDiagnostics(frame.diagnostics);
    }
    catch (error)
    {
        failAnimatorPreview(error);
    }
}

function initializeCensorshipTypes(runtimePackage: AnimatorRuntimePackage) {
    const available = new Set<CensorshipType>(["unedited"]);

    if (runtimePackage.hasRPlusPresentation)
        available.add("rplus");
    if (mosaicLayer?.hasPresentation)
        available.add("pixelated");

    availableCensorshipTypes.value = available;
    selectedCensorshipType.value = props.skin.isRPlusSkin && available.has("rplus")
        ? "rplus"
        : "unedited";
}

function applySelectedCensorship() {
    if (!pixiScene || frameFailed || !availableCensorshipTypes.value.has(selectedCensorshipType.value))
        return;

    try
    {
        const usesRPlusPresentation = selectedCensorshipType.value === "rplus" || selectedCensorshipType.value === "pixelated";
        const frame = pixiScene.setRPlusEnabled(usesRPlusPresentation);

        mosaicLayer?.setVisible(selectedCensorshipType.value === "pixelated");
        interactionLayer?.update();

        updateDiagnostics(frame.diagnostics);
    }
    catch (error)
    {
        failAnimatorPreview(error);
    }
}

function updateDiagnostics(nextDiagnostics: readonly string[]) {
    const current = diagnostics.value;

    if (current.length === nextDiagnostics.length && current.every((diagnostic, index) => diagnostic === nextDiagnostics[index]))
        return;

    diagnostics.value = [...nextDiagnostics];
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

function toggleAnimationPlayback() {
    if (!pixiScene || frameFailed)
        return;

    isAnimationPaused.value = !isAnimationPaused.value;
}

function resetCharacterState() {
    if (!pixiScene || frameFailed)
        return;

    try {
        const frame = pixiScene.reset();

        mosaicLayer?.update();
        interactionLayer?.update();

        isAnimationPaused.value = false;
        updateDiagnostics(frame.diagnostics);
    }
    catch (error) {
        failAnimatorPreview(error);
    }
}

function failAnimatorPreview(error: unknown) {
    frameFailed = true;
    application?.ticker.remove(updateAnimatorFrame);

    errorMessage.value = ErrorUtils.getUserErrorMessage(error, "The Animator preview stopped unexpectedly.");
    RendererLogger.error(ApplicationLogSource.modLibrary, `The Animator preview frame failed for "${props.mod.directoryName}".`, error);
}

function toggleHitboxVisibility() {
    areHitboxesVisible.value = !areHitboxesVisible.value;

    interactionLayer?.setOutlinesVisible(areHitboxesVisible.value);
}

function requireCurrentLoad(generation: number, signal: AbortSignal) {
    if (disposed || signal.aborted || generation !== loadGeneration)
        throw createAbortError();
}

function createAbortError(): DOMException {
    return new DOMException("The Animator preview load was cancelled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

onBeforeUnmount(() => {
    disposed = true;
    loadGeneration++;

    loadController?.abort();
    loadController = null;

    void destroyRenderer();
});
</script>

<template>
    <section
        class="animator-preview"
        :aria-label="`Animator preview for ${mod.directoryName}`"
    >
        <div
            ref="stageHost"
            class="animator-preview-stage"
            :class="{ 'is-panning': isPanning }"
            :aria-hidden="isLoading || Boolean(errorMessage)"
            @wheel.prevent="handlePreviewWheel"
            @pointerdown="startPreviewPan"
            @pointermove="movePreviewPan"
            @pointerup="finishPreviewPan"
            @pointercancel="finishPreviewPan"
            @lostpointercapture="finishPreviewPan"
        ></div>

        <div
            v-if="!isLoading && !errorMessage"
            class="animator-preview-controls"
        >
            <label class="animator-preview-control-group animator-preview-censorship-control">
                <span>Censorship</span>

                <span class="animator-preview-select-wrap">
                    <select
                        v-model="selectedCensorshipType"
                        aria-label="Censorship type"
                        @change="applySelectedCensorship"
                    >
                        <option
                            value="rplus"
                            :disabled="!availableCensorshipTypes.has('rplus')"
                        >
                            R+{{ availableCensorshipTypes.has("rplus") ? "" : " (not available)" }}
                        </option>

                        <option value="unedited">
                            Unedited
                        </option>

                        <option
                            value="pixelated"
                            :disabled="!availableCensorshipTypes.has('pixelated')"
                        >
                            Pixelated{{ availableCensorshipTypes.has("pixelated") ? "" : " (not available)" }}
                        </option>
                    </select>

                    <span
                        class="animator-preview-select-caret"
                        aria-hidden="true"
                    ></span>
                </span>
            </label>

            <div class="animator-preview-control-group">
                <span>Animation</span>

                <div class="animator-preview-control-buttons">
                    <button
                        class="animator-preview-tool-button"
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
                        class="animator-preview-tool-button"
                        type="button"
                        aria-label="Reset character state"
                        title="Reset character to its initial state"
                        @click="resetCharacterState"
                    >
                        <ResetStateIcon />
                    </button>
                </div>
            </div>

            <div
                v-if="hasInteractionHitboxes"
                class="animator-preview-control-group"
            >
                <span>Touch areas</span>

                <button
                    class="animator-preview-tool-button"
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
        </div>

        <div
            v-if="!isLoading && !errorMessage"
            class="animator-preview-navigation"
        >
            <span class="animator-preview-navigation-hint">Drag to pan · Scroll to zoom</span>
            <span class="animator-preview-zoom-value">{{ previewZoom }}%</span>

            <button
                class="animator-preview-reset-view"
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
            class="animator-preview-state"
            role="status"
        >
            <span
                class="animator-preview-spinner"
                aria-hidden="true"
            ></span>
            <strong>Preparing Animator preview</strong>
            <p>
                Loading and validating the Unity runtime package.
            </p>
        </div>

        <div
            v-else-if="errorMessage"
            class="animator-preview-state is-error"
            role="alert"
        >
            <span
                class="animator-preview-error-mark"
                aria-hidden="true"
            >
                !
            </span>
            <strong>Preview could not be prepared</strong>
            <p>{{ errorMessage }}</p>
        </div>

        <aside
            v-else-if="diagnostics.length"
            class="animator-preview-diagnostics"
            aria-live="polite"
        >
            <strong>
                {{ diagnostics.length }}
                {{ diagnostics.length === 1 ? "preview notice" : "preview notices" }}
            </strong>

            <ul>
                <li
                    v-for="diagnostic in diagnostics"
                    :key="diagnostic"
                >
                    {{ diagnostic }}
                </li>
            </ul>
        </aside>
    </section>
</template>

<style scoped>
.animator-preview {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #070b09;
    color: #f3efe4;
}

.animator-preview-stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
    user-select: none;
}

.animator-preview-stage.is-panning,
.animator-preview-stage.is-panning :deep(canvas) {
    cursor: grabbing !important;
}

.animator-preview-stage :deep(canvas) {
    display: block;
    width: 100%;
    height: 100%;
}

.animator-preview-controls {
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

.animator-preview-control-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: #9ca39d;
    font-size: 11px;
    font-weight: 700;
}

.animator-preview-control-buttons {
    display: flex;
    gap: 5px;
}

.animator-preview-censorship-control {
    min-width: 158px;
}

.animator-preview-select-wrap {
    position: relative;
    display: block;
}

.animator-preview-select-wrap select {
    width: 100%;
    height: 42px;
    padding: 0 38px 0 12px;
    border: 1px solid #303632;
    border-radius: 7px;
    color: #e7e3da;
    background: rgba(18, 22, 19, 0.94);
    box-shadow: 0 5px 18px rgba(0, 0, 0, 0.24);
    font: inherit;
    font-size: 12px;
    font-weight: 650;
    appearance: none;
    cursor: pointer;
}

.animator-preview-select-wrap select:hover {
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.animator-preview-select-wrap select:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.animator-preview-select-wrap option:disabled {
    color: #747a75;
}

.animator-preview-select-caret {
    position: absolute;
    top: 50%;
    right: 13px;
    width: 7px;
    height: 7px;
    border-right: 2px solid #9ea49f;
    border-bottom: 2px solid #9ea49f;
    pointer-events: none;
    transform: translateY(-70%) rotate(45deg);
}

.animator-preview-tool-button {
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

.animator-preview-tool-button:hover {
    color: #f2eee5;
    border-color: #48504b;
    background: rgba(27, 32, 28, 0.97);
}

.animator-preview-tool-button.is-active {
    color: #b9ddf2;
    border-color: #50758a;
    background: rgba(20, 39, 49, 0.96);
}

.animator-preview-tool-button:focus-visible,
.animator-preview-reset-view:focus-visible {
    outline: 2px solid #f2eee5;
    outline-offset: 2px;
}

.animator-preview-tool-button svg {
    width: 21px;
    height: 21px;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.animator-preview-navigation {
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

.animator-preview-navigation-hint {
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}

.animator-preview-zoom-value {
    min-width: 42px;
    color: #d9d7cf;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    text-align: right;
}

.animator-preview-reset-view {
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

.animator-preview-reset-view:hover {
    color: #f2eee5;
    background: #252b27;
}

.animator-preview-reset-view svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
}

.animator-preview-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.animator-preview-state {
    z-index: 2;
    flex-direction: column;
    gap: 0.55rem;
    padding: 2rem;
    background: #070b09;
    text-align: center;
}

.animator-preview-state strong,
.animator-preview-state p {
    margin: 0;
}

.animator-preview-state strong {
    font-size: 1rem;
}

.animator-preview-state p {
    max-width: 34rem;
    color: #9ca59f;
    font-size: 0.86rem;
    line-height: 1.5;
}

.animator-preview-spinner {
    width: 2rem;
    height: 2rem;
    margin-bottom: 0.35rem;
    border: 3px solid #26322d;
    border-top-color: #94bdd5;
    border-radius: 50%;
    animation: animator-preview-spin 750ms linear infinite;
}

.animator-preview-error-mark {
    display: grid;
    width: 2.3rem;
    height: 2.3rem;
    place-items: center;
    margin-bottom: 0.35rem;
    border-radius: 50%;
    background: #39201f;
    color: #f39b96;
    font-size: 1.1rem;
    font-weight: 700;
}

.animator-preview-state.is-error p {
    color: #f0a09b;
}

.animator-preview-diagnostics {
    position: absolute;
    right: 1rem;
    bottom: 4.75rem;
    width: min(28rem, calc(100% - 2rem));
    max-height: min(12rem, 35%);
    overflow: auto;
    padding: 0.8rem 0.9rem;
    border: 1px solid #564024;
    border-radius: 0.65rem;
    background: rgba(27, 23, 15, 0.94);
    color: #e5bd7d;
    box-shadow: 0 0.65rem 1.8rem rgba(0, 0, 0, 0.28);
    pointer-events: auto;
}

.animator-preview-diagnostics > strong {
    font-size: 0.82rem;
}

.animator-preview-diagnostics ul {
    display: grid;
    gap: 0.45rem;
    margin: 0.65rem 0 0;
    padding-left: 1.2rem;
    color: #d1b487;
    font-size: 0.78rem;
    line-height: 1.45;
}

@keyframes animator-preview-spin {
    to {
        transform: rotate(360deg);
    }
}

</style>
