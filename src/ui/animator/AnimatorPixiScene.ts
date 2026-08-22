import type { PreparedAnimatorSkinnedRenderer, PreparedAnimatorSpriteRenderer, PreparedAnimatorMeshRenderer } from "./AnimatorRendererModel";
import type { AnimatorRuntimeFrameResult, AnimatorRuntimePackage } from "./AnimatorRuntimePackage";
import type { AnimatorRuntimeMaterial, AnimatorRendererType } from "./AnimatorBindingResolver";
import type { AnimatorProjectedSpriteRenderer } from "./AnimatorSpriteProjector";
import type { PreparedPreviewSpriteGeometry } from "../../shared/characters";
import type { AnimatorProjectedMesh } from "./AnimatorMeshDeformer";

import { AnimatorPixiParticleView } from "./AnimatorPixiParticleView";
import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

type AnimatorPixiMeshRenderer =
    | PreparedAnimatorMeshRenderer
    | PreparedAnimatorSkinnedRenderer;

type AnimatorPixiMeshView = {
    display: Mesh<MeshGeometry>;
    geometry: MeshGeometry;
    renderer: AnimatorPixiMeshRenderer;
    projection: AnimatorProjectedMesh;
    materialSlot: number;
    submeshOrder: number;
    sourceUv0: Float32Array;
    textureTransform: number[];
};

type AnimatorResolvedMaterialTexture = Readonly<{
    texture: Texture;
    propertyName: string;
}>;

type AnimatorPixiSpriteView = {
    root: Container;
    display: Mesh<MeshGeometry> | null;
    geometry: MeshGeometry | null;
    renderer: PreparedAnimatorSpriteRenderer;
    projector: AnimatorProjectedSpriteRenderer;
    geometryRevision: number;
};

type AnimatorDisplayColor = Readonly<{
    tint: number;
    alpha: number;
}>;

export type AnimatorPixiBounds = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

export type AnimatorPixiFaceAsset = Readonly<{
    assetName: string;
    texture: Texture;
    geometry: PreparedPreviewSpriteGeometry;
}>;

type AnimatorPixiFaceView = {
    display: Mesh<MeshGeometry>;
    geometry: MeshGeometry;
    renderer: PreparedAnimatorSpriteRenderer;
    assetsByName: ReadonlyMap<string, AnimatorPixiFaceAsset>;
    selectedAsset: AnimatorPixiFaceAsset | null;
    localPositions: Float32Array;
    projectedPositions: Float32Array;
};

export type AnimatorPixiSceneOptions = Readonly<{
    includeParticles?: boolean;
    faceAssets?: readonly AnimatorPixiFaceAsset[];
}>;

export class AnimatorPixiScene {
    private readonly materialsById: ReadonlyMap<string, AnimatorRuntimeMaterial>;;
    private readonly meshViews: AnimatorPixiMeshView[] = [];
    private readonly spriteViews: AnimatorPixiSpriteView[] = [];
    private readonly particleViews: AnimatorPixiParticleView[] = [];
    private readonly sortingStride: number;
    private readonly submeshStride: number;
    private faceView: AnimatorPixiFaceView | null = null;
    private destroyed = false;
    readonly root = new Container();

    constructor(
        readonly runtime: AnimatorRuntimePackage,
        private readonly texturesById: ReadonlyMap<string, Texture>,
        options: AnimatorPixiSceneOptions = {}
    ) {
        this.root.sortableChildren = true;
        this.root.scale.set(1, -1);

        this.materialsById = AnimatorRuntimeUtils.indexUniqueById(runtime.manifest.scene.materials, "Material");
        this.submeshStride = this.getMaximumSubmeshCount() + 1;
        this.sortingStride = (runtime.renderers.renderers.length + runtime.particleRenderers.renderers.length + 1) * this.submeshStride;

        this.createMeshViews();
        this.createSpriteViews();
        this.createFaceView(options.faceAssets ?? []);

        if (options.includeParticles !== false)
            this.createParticleViews();

        this.updateViews();
    }

    advance(deltaSeconds: number): AnimatorRuntimeFrameResult {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        const result = this.runtime.advance(deltaSeconds);
        this.updateViews();

        return result;
    }

    refreshViews() {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        this.updateViews();
    }

    reset(): AnimatorRuntimeFrameResult {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        const result = this.runtime.reset();
        this.updateViews();

        return result;
    }

    getVisibleBounds(): AnimatorPixiBounds | null {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        let minimumX = Number.POSITIVE_INFINITY;
        let minimumY = Number.POSITIVE_INFINITY;
        let maximumX = Number.NEGATIVE_INFINITY;
        let maximumY = Number.NEGATIVE_INFINITY;

        const includePositions = (positions: Float32Array<ArrayBufferLike>) => {
            for (let offset = 0; offset < positions.length; offset += 2)
            {
                const x = positions[offset];
                const y = positions[offset + 1];

                if (!Number.isFinite(x) || !Number.isFinite(y))
                    continue;

                minimumX = Math.min(minimumX, x);
                minimumY = Math.min(minimumY, y);
                maximumX = Math.max(maximumX, x);
                maximumY = Math.max(maximumY, y);
            }
        };

        for (const view of this.meshViews)
        {
            if (view.display.visible)
                includePositions(view.projection.positions2d);
        }

        for (const view of this.spriteViews)
        {
            if (view.root.visible)
                includePositions(view.projector.positions2d);
        }

        if (this.faceView?.display.visible)
            includePositions(this.faceView.projectedPositions);

        if (!Number.isFinite(minimumX) || !Number.isFinite(minimumY) || !Number.isFinite(maximumX) || !Number.isFinite(maximumY))
            return null;

        return {
            x: minimumX,
            y: minimumY,
            width: maximumX - minimumX,
            height: maximumY - minimumY
        };
    }

    setRPlusEnabled(enabled: boolean): AnimatorRuntimeFrameResult {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        const result = this.runtime.setRPlusEnabled(enabled);
        this.updateViews();

        return result;
    }

    setDecorationEnabled(group: 1 | 2, enabled: boolean): AnimatorRuntimeFrameResult {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        const result = this.runtime.setDecorationEnabled(group, enabled);
        this.updateViews();

        return result;
    }

    setFace(assetName: string | null) {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        const view = this.faceView;

        if (!view)
        {
            if (assetName !== null)
                throw new Error("The Animator scene has no prepared face renderer.");

            return;
        }

        const wasEnabled = view.selectedAsset !== null;

        if (assetName === null)
        {
            view.selectedAsset = null;
        }
        else
        {
            const asset = view.assetsByName.get(assetName);
            if (!asset)
                throw new Error(`Animator face "${assetName}" is not prepared.`);

            view.selectedAsset = asset;
            view.display.texture = asset.texture;

            this.configureFaceGeometry(view, asset.geometry);
        }

        const isEnabled = view.selectedAsset !== null;

        if (wasEnabled !== isEnabled)
        {
            const triggerName = isEnabled
                ? "Face_On"
                : "Face_Off";

            if (this.runtime.triggerParameter(triggerName) > 0)
                this.runtime.advance(0);
        }

        this.updateViews();
    }

    destroy() {
        if (this.destroyed)
            return;

        this.destroyed = true;

        for (const view of this.meshViews)
        {
            view.display.parent?.removeChild(view.display);
            view.display.destroy();
            view.geometry.destroy(true);
        }

        for (const view of this.spriteViews)
        {
            this.destroySpriteGeometry(view);
            view.root.parent?.removeChild(view.root);
            view.root.destroy({ children: false });
        }

        for (const view of this.particleViews)
            view.destroy();

        if (this.faceView)
        {
            this.faceView.display.parent?.removeChild(this.faceView.display);
            this.faceView.display.destroy();
            this.faceView.geometry.destroy(true);
            this.faceView = null;
        }

        this.meshViews.length = 0;
        this.spriteViews.length = 0;
        this.particleViews.length = 0;

        this.root.destroy({ children: false });
    }

    private createMeshViews() {
        for (const renderer of this.runtime.renderers.meshRenderers)
            this.createMeshRendererViews(renderer, this.runtime.meshDeformer.requireRigid(renderer.id));

        for (const renderer of this.runtime.renderers.skinnedMeshRenderers)
            this.createMeshRendererViews(renderer, this.runtime.meshDeformer.require(renderer.id));
    }

    private createMeshRendererViews(renderer: AnimatorPixiMeshRenderer, projection: AnimatorProjectedMesh) {
        const mesh = renderer.mesh;
        if (!mesh)
            return;

        if (!mesh.uv0)
            throw new Error(`Mesh "${mesh.name}" has no texture coordinates.`);

        const textureCoordinates = AnimatorRuntimeUtils.createTextureCoordinates(mesh.uv0);

        const drawCalls = mesh.submeshes
            .filter((submesh) => submesh.materialSlot < renderer.materials.length)
            .map((submesh) => ({
                submesh,
                materialSlot: submesh.materialSlot
            }));

        if (mesh.submeshes.length > 0)
        {
            const lastSubmesh = mesh.submeshes[mesh.submeshes.length - 1];

            for (let materialSlot = mesh.submeshes.length; materialSlot < renderer.materials.length; materialSlot++)
            {
                drawCalls.push({
                    submesh: lastSubmesh,
                    materialSlot
                });
            }
        }

        for (const [submeshOrder, drawCall] of drawCalls.entries())
        {
            const geometry = new MeshGeometry({
                positions: new Float32Array(projection.positions2d),
                uvs: new Float32Array(textureCoordinates),
                indices: new Uint32Array(drawCall.submesh.indices),
                shrinkBuffersToFit: false
            });

            geometry.batchMode = "no-batch";

            const display = new Mesh({
                geometry,
                texture: Texture.EMPTY
            });

            display.eventMode = "none";

            this.meshViews.push({
                display,
                geometry,
                renderer,
                projection,
                materialSlot: drawCall.materialSlot,
                submeshOrder,
                sourceUv0: textureCoordinates,
                textureTransform: [Number.NaN, Number.NaN, Number.NaN, Number.NaN]
            });

            this.root.addChild(display);
        }
    }

    private createSpriteViews() {
        for (const renderer of this.runtime.renderers.spriteRenderers)
        {
            const root = new Container();
            root.eventMode = "none";

            const projector = this.runtime.spriteProjector.require(renderer.id);

            this.spriteViews.push({
                root,
                display: null,
                geometry: null,
                renderer,
                projector,
                geometryRevision: -1
            });

            this.root.addChild(root);
        }
    }

    private createParticleViews() {
        for (const renderer of this.runtime.particleRenderers.renderers)
        {
            const texture = this.texturesById.get(renderer.textureId);
            if (!texture)
                throw new Error(`ParticleSystemRenderer "${renderer.id}" references unavailable texture "${renderer.textureId}".`);

            const view = new AnimatorPixiParticleView(renderer, texture, this.runtime.hierarchy);

            this.particleViews.push(view);
            this.root.addChild(view.root);
        }
    }

    private createFaceView(faceAssets: readonly AnimatorPixiFaceAsset[]) {
        if (faceAssets.length === 0)
            return;

        const faceDefinition = this.runtime.manifest.scene.interactions.actor.face;
        const renderer = this.runtime.renderers.spriteRenderers.find((candidate) => candidate.id === faceDefinition.rendererId);

        if (!renderer)
            throw new Error(`The Actor face renderer "${faceDefinition.rendererId}" does not exist.`);

        const assetsByName = new Map<string, AnimatorPixiFaceAsset>();

        for (const asset of faceAssets)
        {
            if (assetsByName.has(asset.assetName))
                throw new Error(`Animator face "${asset.assetName}" is duplicated.`);

            assetsByName.set(asset.assetName, asset);
        }

        const geometry = new MeshGeometry({
            positions: new Float32Array(8),
            uvs: new Float32Array([
                0, 1,
                1, 1,
                1, 0,
                0, 0
            ]),
            indices: new Uint32Array([
                0, 1, 2,
                0, 2, 3
            ]),
            shrinkBuffersToFit: false
        });

        geometry.batchMode = "no-batch";

        const display = new Mesh({
            geometry,
            texture: Texture.EMPTY
        });

        display.visible = false;
        display.eventMode = "none";

        this.faceView = {
            display,
            geometry,
            renderer,
            assetsByName,
            selectedAsset: null,
            localPositions: new Float32Array(8),
            projectedPositions: new Float32Array(8)
        };

        this.root.addChild(display);
    }

    private updateViews() {
        this.updateMeshViews();
        this.updateSpriteViews();
        this.updateFaceView();
        this.updateParticleViews();
    }

    private updateMeshViews() {
        for (const view of this.meshViews)
        {
            const rendererType = view.renderer.kind;
            const state = this.runtime.state.requireRenderer(view.renderer.id, rendererType);
            const materialId = state.materialIds[view.materialSlot] ?? null;

            const resolvedTexture = this.resolveMaterialTexture(view.renderer.id, rendererType, view.materialSlot, materialId);
            const texture = resolvedTexture?.texture ?? null;
            const color = this.resolveRendererColor(view.renderer.id, rendererType, view.materialSlot);

            view.display.visible = view.projection.visible && texture !== null && color.alpha > 0;
            view.display.zIndex = state.sortingOrder * this.sortingStride + view.renderer.sourceOrder * this.submeshStride + view.submeshOrder;
            view.display.tint = color.tint;
            view.display.alpha = color.alpha;
            view.display.blendMode = this.resolveMaterialBlendMode(materialId);

            if (resolvedTexture)
            {
                if (view.display.texture !== resolvedTexture.texture)
                    view.display.texture = resolvedTexture.texture;

                this.updateMeshTextureCoordinates(view, rendererType, resolvedTexture.propertyName);
            }

            if (!view.projection.visible)
                continue;

            view.geometry.positions.set(view.projection.positions2d);
            view.geometry.getBuffer("aPosition").update();
        }
    }

    private updateSpriteViews() {
        for (const view of this.spriteViews)
        {
            const state = this.runtime.state.requireSpriteRenderer(view.renderer.id);
            const materialId = state.materialIds[0] ?? null;

            if (view.geometryRevision !== view.projector.geometryRevision)
                this.rebuildSpriteGeometry(view);

            const color = state.materialIds.length > 0
                ? this.resolveRendererColor(view.renderer.id, "SpriteRenderer", 0, state.color)
                : this.createDisplayColor(state.color);

            view.root.visible = view.projector.visible && view.display !== null && color.alpha > 0;
            view.root.zIndex = state.sortingOrder * this.sortingStride + view.renderer.sourceOrder * this.submeshStride;

            if (!view.display)
                continue;

            view.display.tint = color.tint;
            view.display.alpha = color.alpha;
            view.display.blendMode = this.resolveMaterialBlendMode(materialId);

            if (!view.projector.visible || !view.geometry)
                continue;

            view.geometry.positions.set(view.projector.positions2d);
            view.geometry.getBuffer("aPosition").update();
        }
    }

    private updateParticleViews() {
        const ordinaryRendererCount = this.runtime.renderers.renderers.length;

        for (const view of this.particleViews)
        {
            const state = this.runtime.state.requireParticleSystemRenderer(view.renderer.id);
            const sourceOrder = ordinaryRendererCount + view.renderer.sourceOrder;
            const zIndex = state.sortingOrder * this.sortingStride + sourceOrder * this.submeshStride;
            const value = this.runtime.state.getMaterialPropertyValue(
                view.renderer.id,
                "ParticleSystemRenderer",
                view.renderer.materialSlot,
                "_MainTex_ST",
                "textureTransform"
            );

            view.update({
                enabled: state.enabled,
                zIndex,
                textureTransform: Array.isArray(value) && value.length === 4
                    ? value
                    : [1, 1, 0, 0]
            });
        }
    }

    private updateFaceView() {
        const view = this.faceView;
        if (!view)
            return;

        const state = this.runtime.state.requireSpriteRenderer(view.renderer.id);
        const color = state.materialIds.length > 0
            ? this.resolveRendererColor(view.renderer.id, "SpriteRenderer", 0, state.color)
            : this.createDisplayColor(state.color);

        const visible =
            view.selectedAsset !== null && state.enabled &&
            this.runtime.hierarchy.isGameObjectActiveInHierarchy(view.renderer.gameObjectId) && color.alpha > 0;

        view.display.visible = visible;
        view.display.zIndex = state.sortingOrder * this.sortingStride - 1;
        view.display.tint = color.tint;
        view.display.alpha = color.alpha;

        if (!visible)
            return;

        const worldMatrix = this.runtime.hierarchy.requireWorldMatrix(view.renderer.transformId);
        const flipX = state.flipX ? -1 : 1;
        const flipY = state.flipY ? -1 : 1;

        for (let offset = 0; offset < view.localPositions.length; offset += 2)
        {
            const x = view.localPositions[offset] * flipX;
            const y = view.localPositions[offset + 1] * flipY;

            view.projectedPositions[offset] = worldMatrix[0] * x + worldMatrix[1] * y + worldMatrix[3];
            view.projectedPositions[offset + 1] = worldMatrix[4] * x + worldMatrix[5] * y + worldMatrix[7];
        }

        view.geometry.positions.set(view.projectedPositions);
        view.geometry.getBuffer("aPosition").update();
    }

    private updateMeshTextureCoordinates(view: AnimatorPixiMeshView, rendererType: AnimatorRendererType, texturePropertyName: string) {
        const value = this.runtime.state.getMaterialPropertyValue(
            view.renderer.id,
            rendererType,
            view.materialSlot,
            `${texturePropertyName}_ST`,
            "textureTransform"
        );

        const transform = Array.isArray(value) && value.length === 4
            ? value
            : [1, 1, 0, 0];

        if (view.textureTransform.every((component, index) => component === transform[index]))
            return;

        AnimatorRuntimeUtils.writeTransformedTextureCoordinates(view.geometry.uvs, view.sourceUv0, transform);
        view.geometry.getBuffer("aUV").update();

        AnimatorRuntimeUtils.copyFiniteVector(view.textureTransform, transform, 4, `Renderer "${view.renderer.id}" texture transform`);
    }

    private rebuildSpriteGeometry(view: AnimatorPixiSpriteView) {
        this.destroySpriteGeometry(view);

        view.geometryRevision = view.projector.geometryRevision;

        const textureId = view.projector.textureId;
        const uv0 = view.projector.uv0;

        if (!view.projector.sprite || !textureId || !uv0 || view.projector.positions2d.length === 0 || view.projector.indices.length === 0)
            return;

        const texture = this.texturesById.get(textureId);
        if (!texture)
            throw new Error(`Sprite "${view.projector.sprite.name}" references unavailable texture "${textureId}".`);

        const geometry = new MeshGeometry({
            positions: new Float32Array(view.projector.positions2d),
            uvs: AnimatorRuntimeUtils.createTextureCoordinates(uv0),
            indices: new Uint32Array(view.projector.indices),
            shrinkBuffersToFit: false
        });

        geometry.batchMode = "no-batch";

        const display = new Mesh({
            geometry,
            texture
        });

        display.eventMode = "none";

        view.geometry = geometry;
        view.display = display;

        view.root.addChild(display);
    }

    private destroySpriteGeometry(view: AnimatorPixiSpriteView) {
        if (view.display)
        {
            view.display.parent?.removeChild(view.display);
            view.display.destroy();
            view.display = null;
        }

        if (view.geometry)
        {
            view.geometry.destroy(true);
            view.geometry = null;
        }
    }

    private configureFaceGeometry(view: AnimatorPixiFaceView, geometry: PreparedPreviewSpriteGeometry) {
        if (geometry.pixelWidth <= 0 || geometry.pixelHeight <= 0 || geometry.pixelsPerUnit <= 0)
            throw new Error("The selected Animator face has invalid Sprite geometry.");

        const width = geometry.pixelWidth / geometry.pixelsPerUnit;
        const height = geometry.pixelHeight / geometry.pixelsPerUnit;
        const left = -geometry.pivot.x * width;
        const right = left + width;
        const bottom = -geometry.pivot.y * height;
        const top = bottom + height;

        view.localPositions.set([
            left, bottom,
            right, bottom,
            right, top,
            left, top
        ]);
    }

    private resolveMaterialTexture(
        rendererId: string,
        rendererType: AnimatorRendererType,
        materialSlot: number,
        materialId: string | null
    ): AnimatorResolvedMaterialTexture | null {
        if (!materialId)
            return null;

        const material = this.materialsById.get(materialId);
        if (!material)
            return null;

        const textureProperty =
            material.textureProperties.find((property) => property.name === "_MainTex") ??
            material.textureProperties.find((property) => property.textureId !== null);

        if (!textureProperty)
            return null;

        const textureId = this.runtime.state.getMaterialTextureId(rendererId, rendererType, materialSlot, textureProperty.name);
        const texture = textureId
            ? this.texturesById.get(textureId) ?? null
            : null;

        return texture
            ? { texture, propertyName: textureProperty.name }
            : null;
    }

    private resolveRendererColor(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, multiplier: readonly number[] = [1, 1, 1, 1]): AnimatorDisplayColor {
        const color = [1, 1, 1, 1];

        for (const propertyName of ["_Color", "_TintColor", "_RendererColor"])
        {
            const value = this.getMaterialVector(rendererId, rendererType, materialSlot, propertyName);
            if (!value)
                continue;

            color[0] *= value[0] ?? 1;
            color[1] *= value[1] ?? 1;
            color[2] *= value[2] ?? 1;
            color[3] *= value[3] ?? 1;
        }

        const state = this.runtime.state.requireRenderer(rendererId, rendererType);
        const materialId = state.materialIds[materialSlot] ?? null;
        const material = materialId
            ? this.materialsById.get(materialId) ?? null
            : null;

        if (material?.blendMode === "add")
        {
            color[0] *= 2;
            color[1] *= 2;
            color[2] *= 2;
            color[3] *= 2;
        }

        const additionalAlpha = this.getMaterialScalar(rendererId, rendererType, materialSlot, "_AdditionalAlpha") ?? 1;

        return this.createDisplayColor([
            color[0] * (multiplier[0] ?? 1),
            color[1] * (multiplier[1] ?? 1),
            color[2] * (multiplier[2] ?? 1),
            color[3] * additionalAlpha * (multiplier[3] ?? 1)
        ]);
    }

    private resolveMaterialBlendMode(materialId: string | null): AnimatorRuntimeMaterial["blendMode"] {
        if (!materialId)
            return "normal";

        return this.materialsById.get(materialId)?.blendMode ?? "normal";
    }

    private createDisplayColor(color: readonly number[]): AnimatorDisplayColor {
        const red = this.clamp01(color[0] ?? 1);
        const green = this.clamp01(color[1] ?? 1);
        const blue = this.clamp01(color[2] ?? 1);
        const alpha = this.clamp01(color[3] ?? 1);

        return {
            tint:
                (Math.round(red * 255) << 16) |
                (Math.round(green * 255) << 8) |
                Math.round(blue * 255),
            alpha
        };
    }

    private getMaterialVector(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, propertyName: string): readonly number[] | null {
        const value = this.runtime.state.getMaterialPropertyValue(rendererId, rendererType, materialSlot, propertyName, "vector");

        return Array.isArray(value) && value.length === 4
            ? value
            : null;
    }

    private getMaterialScalar(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, propertyName: string): number | null {
        const value = this.runtime.state.getMaterialPropertyValue(rendererId, rendererType, materialSlot, propertyName, "float");

        return typeof value === "number" && Number.isFinite(value)
            ? value
            : null;
    }

    private getMaximumSubmeshCount(): number {
        let result = 1;

        for (const renderer of this.runtime.renderers.skinnedMeshRenderers)
            result = Math.max(result, renderer.mesh?.submeshes.length ?? 0);

        return result;
    }

    private clamp01(value: number): number {
        if (!Number.isFinite(value))
            return 0;

        return Math.min(1, Math.max(0, value));
    }
}
