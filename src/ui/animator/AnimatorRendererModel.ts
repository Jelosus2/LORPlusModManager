import type {
    AnimatorRuntimeMaterial,
    AnimatorRuntimeScene,
    AnimatorRuntimeSkinnedMeshRenderer,
    AnimatorRuntimeSpriteRenderer,
    AnimatorRuntimeMeshRenderer
} from "./AnimatorBindingResolver";
import type { PreparedAnimatorMesh, PreparedAnimatorSprite } from "./AnimatorPreparedGeometry";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";

import { AnimatorPreparedGeometry } from "./AnimatorPreparedGeometry";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type PreparedAnimatorMaterialSlot = Readonly<{
    materialId: string | null;
    material: AnimatorRuntimeMaterial | null;
}>;

export type PreparedAnimatorMeshRenderer = Readonly<{
    kind: "MeshRenderer";
    id: string;
    gameObjectId: string;
    transformId: string;
    sourceOrder: number;
    mesh: PreparedAnimatorMesh | null;
    materials: readonly PreparedAnimatorMaterialSlot[];
}>;

export type PreparedAnimatorSkinnedRenderer = Readonly<{
    kind: "SkinnedMeshRenderer";
    id: string;
    gameObjectId: string;
    transformId: string;
    sourceOrder: number;
    mesh: PreparedAnimatorMesh | null;
    materials: readonly PreparedAnimatorMaterialSlot[];
    boneTransformIds: readonly (string | null)[];
    rootBoneTransformId: string | null;
    bindPoses: readonly Float32Array[];
}>;

export type PreparedAnimatorSpriteRenderer = Readonly<{
    kind: "SpriteRenderer";
    id: string;
    gameObjectId: string;
    transformId: string;
    sourceOrder: number;
    sprite: PreparedAnimatorSprite | null;
    materials: readonly PreparedAnimatorMaterialSlot[];
}>;

export type PreparedAnimatorRenderer =
    | PreparedAnimatorMeshRenderer
    | PreparedAnimatorSkinnedRenderer
    | PreparedAnimatorSpriteRenderer;

export class AnimatorRendererModel {
    private readonly WEIGHT_EPSILON = 0.000001;
    private readonly materialsById: Map<string, AnimatorRuntimeMaterial>;
    readonly meshRenderers: readonly PreparedAnimatorMeshRenderer[];
    readonly skinnedMeshRenderers: readonly PreparedAnimatorSkinnedRenderer[];
    readonly spriteRenderers: readonly PreparedAnimatorSpriteRenderer[];
    readonly renderers: readonly PreparedAnimatorRenderer[];

    constructor(
        scene: AnimatorRuntimeScene,
        private readonly geometry: AnimatorPreparedGeometry,
        private readonly hierarchy: AnimatorTransformHierarchy
    ) {
        this.materialsById = AnimatorRuntimeUtils.indexUniqueById(scene.materials, "Material");

        const rendererIds = new Set<string>();
        let sourceOrder = 0;

        this.meshRenderers = scene.meshRenderers
            .filter((renderer) => renderer.meshId !== null && renderer.materialIds.some((materialId) => materialId !== null))
            .map((renderer) => {
                this.requireUniqueRendererId(renderer.id, rendererIds);

                return this.prepareMeshRenderer(renderer, sourceOrder++);
            });

        const skinnedMeshRenderers: PreparedAnimatorSkinnedRenderer[] = [];

        for (const renderer of scene.skinnedMeshRenderers)
        {
            const rendererSourceOrder = sourceOrder++;

            if (!this.isRenderableSkinnedMeshRenderer(renderer))
                continue;

            this.requireUniqueRendererId(renderer.id, rendererIds);

            skinnedMeshRenderers.push(this.prepareSkinnedMeshRenderer(renderer, rendererSourceOrder));
        }

        this.skinnedMeshRenderers = skinnedMeshRenderers;

        this.spriteRenderers = scene.spriteRenderers.map((renderer) => {
            this.requireUniqueRendererId(renderer.id, rendererIds);

            return this.prepareSpriteRenderer(renderer, sourceOrder++);
        });

        this.renderers = [
            ...this.meshRenderers,
            ...this.skinnedMeshRenderers,
            ...this.spriteRenderers
        ].sort((left, right) => left.sourceOrder - right.sourceOrder);
    }

    private prepareMeshRenderer(renderer: AnimatorRuntimeMeshRenderer, sourceOrder: number): PreparedAnimatorMeshRenderer {
        const transformId = this.hierarchy.requireTransformIdForGameObject(renderer.gameObjectId);
        const mesh = renderer.meshId
            ? this.geometry.requireMesh(renderer.meshId)
            : null;

        return {
            kind: "MeshRenderer",
            id: renderer.id,
            gameObjectId: renderer.gameObjectId,
            transformId,
            sourceOrder,
            mesh,
            materials: this.prepareMaterials(renderer.materialIds)
        };
    }

    private prepareSkinnedMeshRenderer(renderer: AnimatorRuntimeSkinnedMeshRenderer, sourceOrder: number): PreparedAnimatorSkinnedRenderer {
        const transformId = this.hierarchy.requireTransformIdForGameObject(renderer.gameObjectId);
        const mesh = renderer.meshId
            ? this.geometry.requireMesh(renderer.meshId)
            : null;

        for (const boneTransformId of renderer.boneTransformIds)
        {
            if (boneTransformId)
                this.hierarchy.requireWorldMatrix(boneTransformId);
        }

        if (renderer.rootBoneTransformId)
            this.hierarchy.requireWorldMatrix(renderer.rootBoneTransformId);

        const bindPoses = mesh
            ? this.prepareBindPoses(renderer, mesh)
            : [];

        if (mesh)
            this.validateSkinning(renderer, mesh, bindPoses);

        return {
            kind: "SkinnedMeshRenderer",
            id: renderer.id,
            gameObjectId: renderer.gameObjectId,
            transformId,
            sourceOrder,
            mesh,
            materials: this.prepareMaterials(renderer.materialIds),
            boneTransformIds: [...renderer.boneTransformIds],
            rootBoneTransformId: renderer.rootBoneTransformId,
            bindPoses
        };
    }

    private prepareSpriteRenderer(renderer: AnimatorRuntimeSpriteRenderer, sourceOrder: number): PreparedAnimatorSpriteRenderer {
        const transformId = this.hierarchy.requireTransformIdForGameObject(renderer.gameObjectId);
        const sprite = renderer.spriteId
            ? this.geometry.requireSprite(renderer.spriteId)
            : null;

        return {
            kind: "SpriteRenderer",
            id: renderer.id,
            gameObjectId: renderer.gameObjectId,
            transformId,
            sourceOrder,
            sprite,
            materials: this.prepareMaterials(renderer.materialIds)
        };
    }

    private prepareBindPoses(renderer: AnimatorRuntimeSkinnedMeshRenderer, mesh: PreparedAnimatorMesh): readonly Float32Array[] {
        if (!mesh.bindPoses)
            return [];

        if (mesh.bindPoses.length % 16 !== 0)
            throw new Error(`Mesh "${mesh.name}" has an invalid bind-pose array.`);

        const bindPoseCount = mesh.bindPoses.length / 16;
        if (bindPoseCount !== renderer.boneTransformIds.length)
        {
            throw new Error(
                `SkinnedMeshRenderer "${renderer.id}" has ${renderer.boneTransformIds.length} bones but its Mesh has ${bindPoseCount} bind poses.`
            );
        }

        const result: Float32Array[] = [];

        for (let i = 0; i < bindPoseCount; i++)
            result.push(mesh.bindPoses.subarray(i * 16, i * 16 + 16));

        return result;
    }

    private validateSkinning(renderer: AnimatorRuntimeSkinnedMeshRenderer, mesh: PreparedAnimatorMesh, bindPoses: readonly Float32Array[]) {
        const boneIndices = mesh.boneIndices;
        const boneWeights = mesh.boneWeights;

        if (!boneIndices || !boneWeights)
            return;

        let hasWeightedVertex = false;

        for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex++)
        {
            const influenceOffset = vertexIndex * 4;

            for (let influence = 0; influence < 4; influence++)
            {
                const offset = influenceOffset + influence;
                const weight = boneWeights[offset];

                if (weight <= this.WEIGHT_EPSILON)
                    continue;

                hasWeightedVertex = true;

                const boneIndex = boneIndices[offset];
                if (boneIndex >= renderer.boneTransformIds.length)
                    throw new Error(`Mesh "${mesh.name}" vertex ${vertexIndex} references out-of-range bone ${boneIndex}.`);

                const boneTransformId = renderer.boneTransformIds[boneIndex];
                if (!boneTransformId)
                    throw new Error(`Mesh "${mesh.name}" vertex ${vertexIndex} references a missing bone Transform.`);
            }
        }

        if (hasWeightedVertex && bindPoses.length === 0)
            throw new Error(`SkinnedMeshRenderer "${renderer.id}" has weighted geometry but no bind poses.`);
    }

    private prepareMaterials(materialIds: readonly (string | null)[]): readonly PreparedAnimatorMaterialSlot[] {
        return materialIds.map((materialId) => {
            if (!materialId)
            {
                return {
                    materialId: null,
                    material: null
                };
            }

            const material = this.materialsById.get(materialId);
            if (!material)
                throw new Error(`Material "${materialId}" is missing from the Animator runtime scene.`);

            return {
                materialId,
                material
            };
        });
    }

    private requireUniqueRendererId(rendererId: string, rendererIds: Set<string>) {
        if (rendererIds.has(rendererId))
            throw new Error(`Renderer "${rendererId}" is duplicated.`);

        rendererIds.add(rendererId);
    }

    private isRenderableSkinnedMeshRenderer(renderer: AnimatorRuntimeSkinnedMeshRenderer): boolean {
        return renderer.meshId !== null && renderer.materialIds.some((materialId) => materialId !== null);
    }
}
