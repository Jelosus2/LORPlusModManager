import type { PreparedAnimatorSkinnedRenderer, PreparedAnimatorSpriteRenderer } from "./AnimatorRendererModel";
import type { AnimatorRuntimeFrameResult, AnimatorRuntimePackage } from "./AnimatorRuntimePackage";
import type { AnimatorProjectedSpriteRenderer } from "./AnimatorSpriteProjector";
import type { AnimatorDeformedSkinnedMesh } from "./AnimatorMeshDeformer";
import type { AnimatorRuntimeMaterial } from "./AnimatorBindingResolver";

import { AnimatorPixiParticleView } from "./AnimatorPixiParticleView";
import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

type AnimatorRendererType =
    | "SkinnedMeshRenderer"
    | "SpriteRenderer";

type AnimatorPixiMeshView = {
    display: Mesh<MeshGeometry>;
    geometry: MeshGeometry;
    renderer: PreparedAnimatorSkinnedRenderer;
    deformer: AnimatorDeformedSkinnedMesh;
    materialSlot: number;
    submeshOrder: number;
};

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

export class AnimatorPixiScene {
    private readonly materialsById: ReadonlyMap<string, AnimatorRuntimeMaterial>;;
    private readonly meshViews: AnimatorPixiMeshView[] = [];
    private readonly spriteViews: AnimatorPixiSpriteView[] = [];
    private readonly particleViews: AnimatorPixiParticleView[] = [];
    private readonly sortingStride: number;
    private readonly submeshStride: number;
    private destroyed = false;
    readonly root = new Container();

    constructor(readonly runtime: AnimatorRuntimePackage, private readonly texturesById: ReadonlyMap<string, Texture>) {
        this.root.sortableChildren = true;
        this.root.scale.set(1, -1);

        this.materialsById = AnimatorRuntimeUtils.indexUniqueById(runtime.manifest.scene.materials, "Material");
        this.submeshStride = this.getMaximumSubmeshCount() + 1;
        this.sortingStride = (runtime.renderers.renderers.length + runtime.particleRenderers.renderers.length + 1) * this.submeshStride;

        this.createSkinnedMeshViews();
        this.createSpriteViews();
        this.createParticleViews();
        this.updateViews();
    }

    advance(deltaSeconds: number): AnimatorRuntimeFrameResult {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi scene");

        const result = this.runtime.advance(deltaSeconds);
        this.updateViews();

        return result;
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
                const y = -positions[offset + 1];

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
                includePositions(view.deformer.positions2d);
        }

        for (const view of this.spriteViews)
        {
            if (view.root.visible)
                includePositions(view.projector.positions2d);
        }

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

        this.meshViews.length = 0;
        this.spriteViews.length = 0;
        this.particleViews.length = 0;

        this.root.destroy({ children: false });
    }

    private createSkinnedMeshViews() {
        for (const renderer of this.runtime.renderers.skinnedMeshRenderers)
        {
            const mesh = renderer.mesh;
            if (!mesh)
                continue;

            if (!mesh.uv0)
                throw new Error(`Mesh "${mesh.name}" has no texture coordinates.`);

            const deformer = this.runtime.meshDeformer.meshes.get(renderer.id);
            if (!deformer)
                throw new Error(`Renderer "${renderer.id}" has no prepared mesh deformer.`);

            const textureCoordinates = this.createTextureCoordinates(mesh.uv0);

            for (const [submeshOrder, submesh] of mesh.submeshes.entries())
            {
                if (submesh.materialSlot >= renderer.materials.length)
                    throw new Error(`Mesh "${mesh.name}" submesh ${submeshOrder} references an invalid material slot.`);

                const geometry = new MeshGeometry({
                    positions: new Float32Array(deformer.positions2d),
                    uvs: new Float32Array(textureCoordinates),
                    indices: new Uint32Array(submesh.indices),
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
                    deformer,
                    materialSlot: submesh.materialSlot,
                    submeshOrder
                });

                this.root.addChild(display);
            }
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

    private updateViews() {
        this.updateSkinnedMeshViews();
        this.updateSpriteViews();
        this.updateParticleViews();
    }

    private updateSkinnedMeshViews() {
        for (const view of this.meshViews)
        {
            const state = this.runtime.state.requireSkinnedMeshRenderer(view.renderer.id);
            const texture = this.resolveMaterialTexture(view.renderer.id, "SkinnedMeshRenderer", view.materialSlot, state.materialIds[view.materialSlot] ?? null);
            const color = this.resolveRendererColor(view.renderer.id, "SkinnedMeshRenderer", view.materialSlot);

            view.display.visible = view.deformer.visible && texture !== null && color.alpha > 0;
            view.display.zIndex = state.sortingOrder * this.sortingStride + view.renderer.sourceOrder * this.submeshStride + view.submeshOrder;
            view.display.tint = color.tint;
            view.display.alpha = color.alpha;

            if (texture && view.display.texture !== texture)
                view.display.texture = texture;

            if (!view.deformer.visible)
                continue;

            view.geometry.positions.set(view.deformer.positions2d);
            view.geometry.getBuffer("aPosition").update();
        }
    }

    private updateSpriteViews() {
        for (const view of this.spriteViews)
        {
            const state = this.runtime.state.requireSpriteRenderer(view.renderer.id);
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
            const sourceOrder = ordinaryRendererCount + view.renderer.sourceOrder;
            const zIndex = view.renderer.sortingOrder * this.sortingStride + sourceOrder * this.submeshStride;

            view.update(zIndex);
        }
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
            uvs: this.createTextureCoordinates(uv0),
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

    private resolveMaterialTexture(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, materialId: string | null): Texture | null {
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

        return textureId
            ? this.texturesById.get(textureId) ?? null
            : null;
    }

    private resolveRendererColor(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, multiplier: readonly number[] = [1, 1, 1, 1]): AnimatorDisplayColor {
        const baseColor = this.getMaterialVector(rendererId, rendererType, materialSlot, "_Color") ?? [1, 1, 1, 1];
        const rendererColor = this.getMaterialVector(rendererId, rendererType, materialSlot, "_RendererColor") ?? [1, 1, 1, 1];
        const additionalAlpha = this.getMaterialScalar(rendererId, rendererType, materialSlot, "_AdditionalAlpha") ?? 1;

        return this.createDisplayColor([
            baseColor[0] * rendererColor[0] * (multiplier[0] ?? 1),
            baseColor[1] * rendererColor[1] * (multiplier[1] ?? 1),
            baseColor[2] * rendererColor[2] * (multiplier[2] ?? 1),
            baseColor[3] * rendererColor[3] * additionalAlpha * (multiplier[3] ?? 1)
        ]);
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

    private createTextureCoordinates(source: Float32Array): Float32Array {
        const result = new Float32Array(source.length);

        for (let offset = 0; offset < source.length; offset += 2)
        {
            result[offset] = source[offset];
            result[offset + 1] = 1 - source[offset + 1];
        }

        return result;
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
