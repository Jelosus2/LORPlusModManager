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
    private readonly initiallyInactiveGameObjectIds: ReadonlySet<string>;
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
        this.initiallyInactiveGameObjectIds = new Set(scene.gameObjects.filter((gameObject) => !gameObject.active).map((gameObject) => gameObject.id));

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

            const mesh = this.geometry.requireMesh(renderer.meshId!);
            if (this.isInactiveAmbiguousPaletteDuplicate(renderer, mesh, scene.skinnedMeshRenderers))
                continue;

            this.requireUniqueRendererId(renderer.id, rendererIds);

            skinnedMeshRenderers.push(this.prepareSkinnedMeshRenderer(renderer, rendererSourceOrder, scene.skinnedMeshRenderers));
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

    private prepareSkinnedMeshRenderer(
        renderer: AnimatorRuntimeSkinnedMeshRenderer,
        sourceOrder: number,
        allRenderers: readonly AnimatorRuntimeSkinnedMeshRenderer[]
    ): PreparedAnimatorSkinnedRenderer {
        const transformId = this.hierarchy.requireTransformIdForGameObject(renderer.gameObjectId);

        const mesh = renderer.meshId
            ? this.geometry.requireMesh(renderer.meshId)
            : null;

        const boneTransformIds = mesh
            ? this.resolveBoneTransformIds(renderer, mesh, allRenderers)
            : [...renderer.boneTransformIds];

        for (const boneTransformId of boneTransformIds)
        {
            if (boneTransformId)
                this.hierarchy.requireWorldMatrix(boneTransformId);
        }

        if (renderer.rootBoneTransformId)
            this.hierarchy.requireWorldMatrix(renderer.rootBoneTransformId);

        const bindPoses = mesh
            ? this.prepareBindPoses(mesh)
            : [];

        if (mesh)
            this.validateSkinning(renderer, mesh, boneTransformIds, bindPoses);

        return {
            kind: "SkinnedMeshRenderer",
            id: renderer.id,
            gameObjectId: renderer.gameObjectId,
            transformId,
            sourceOrder,
            mesh,
            materials: this.prepareMaterials(renderer.materialIds),
            boneTransformIds,
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

    private prepareBindPoses(mesh: PreparedAnimatorMesh): readonly Float32Array[] {
        if (!mesh.bindPoses)
            return [];

        if (mesh.bindPoses.length % 16 !== 0)
            throw new Error(`Mesh "${mesh.name}" has an invalid bind-pose array.`);

        const bindPoseCount = mesh.bindPoses.length / 16;
        const result: Float32Array[] = [];

        for (let i = 0; i < bindPoseCount; i++)
            result.push(mesh.bindPoses.subarray(i * 16, i * 16 + 16));

        return result;
    }

    private validateSkinning(
        renderer: AnimatorRuntimeSkinnedMeshRenderer,
        mesh: PreparedAnimatorMesh,
        boneTransformIds: readonly (string | null)[],
        bindPoses: readonly Float32Array[]
    ) {
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
                if (boneIndex >= boneTransformIds.length)
                    throw new Error(`Mesh "${mesh.name}" vertex ${vertexIndex} references out-of-range bone ${boneIndex}.`);

                const boneTransformId = boneTransformIds[boneIndex];
                if (!boneTransformId)
                    throw new Error(`Mesh "${mesh.name}" vertex ${vertexIndex} references a missing bone Transform.`);
            }
        }

        if (hasWeightedVertex && bindPoses.length === 0)
            throw new Error(`SkinnedMeshRenderer "${renderer.id}" has weighted geometry but no bind poses.`);
    }

    private resolveBoneTransformIds(
        renderer: AnimatorRuntimeSkinnedMeshRenderer,
        mesh: PreparedAnimatorMesh,
        allRenderers: readonly AnimatorRuntimeSkinnedMeshRenderer[]
    ): readonly (string | null)[] {
        if (!mesh.bindPoses)
            return [...renderer.boneTransformIds];

        const bindPoseCount = mesh.bindPoses.length / 16;
        let paletteToMatch = renderer.boneTransformIds;

        if (paletteToMatch.length === bindPoseCount && this.hasCompleteWeightedBonePalette(mesh, paletteToMatch))
            return [...paletteToMatch];

        if (paletteToMatch.length > bindPoseCount)
        {
            const boneIndices = mesh.boneIndices;
            const boneWeights = mesh.boneWeights;
            let referencesExtraBone = false;

            if (boneIndices && boneWeights)
            {
                for (let offset = 0; offset < boneWeights.length; offset++)
                {
                    if (boneWeights[offset] > this.WEIGHT_EPSILON && boneIndices[offset] >= bindPoseCount)
                    {
                        referencesExtraBone = true;
                        break;
                    }
                }
            }

            if (!referencesExtraBone)
            {
                paletteToMatch = paletteToMatch.slice(0, bindPoseCount);

                if (this.hasCompleteWeightedBonePalette(mesh, paletteToMatch))
                    return [...paletteToMatch];
            }
        }

        const compatiblePalettes = allRenderers
            .filter((candidate) =>
                candidate.id !== renderer.id &&
                candidate.meshId === renderer.meshId &&
                candidate.boneTransformIds.length === bindPoseCount &&
                this.hasCompleteWeightedBonePalette(mesh, candidate.boneTransformIds) &&
                this.isCompatibleBonePalette(paletteToMatch, candidate.boneTransformIds)
            )
            .map((candidate) => candidate.boneTransformIds);

        const uniquePalettes = new Map<string, readonly (string | null)[]>();

        for (const palette of compatiblePalettes)
            uniquePalettes.set(JSON.stringify(palette), palette);

        if (uniquePalettes.size === 1)
            return [...uniquePalettes.values().next().value!];

        if (paletteToMatch.length === bindPoseCount)
            throw new Error(`SkinnedMeshRenderer "${renderer.id}" has unresolved weighted bone Transforms and no unique compatible palette.`);

        throw new Error(`SkinnedMeshRenderer "${renderer.id}" has ${renderer.boneTransformIds.length} bones but its Mesh has ${bindPoseCount} bind poses.`);
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

    private isInactiveAmbiguousPaletteDuplicate(
        renderer: AnimatorRuntimeSkinnedMeshRenderer,
        mesh: PreparedAnimatorMesh,
        allRenderers: readonly AnimatorRuntimeSkinnedMeshRenderer[]
    ): boolean {
        if (
            !this.initiallyInactiveGameObjectIds.has(renderer.gameObjectId) ||
            renderer.boneTransformIds.length !== 0 ||
            renderer.rootBoneTransformId !== null
        )
        {
            return false;
        }

        const bindPoses = mesh.bindPoses;
        const boneWeights = mesh.boneWeights;

        if (!bindPoses || bindPoses.length === 0 || bindPoses.length % 16 !== 0 || !boneWeights)
            return false;

        const hasWeightedGeometry = boneWeights.some((weight) => weight > this.WEIGHT_EPSILON);
        if (!hasWeightedGeometry)
            return false;

        const bindPoseCount = bindPoses.length / 16;
        const uniquePalettes = new Set<string>();

        for (const candidate of allRenderers)
        {
            if (
                candidate.id === renderer.id ||
                candidate.meshId !== renderer.meshId ||
                candidate.boneTransformIds.length !== bindPoseCount ||
                !this.hasCompleteWeightedBonePalette(mesh, candidate.boneTransformIds)
            )
            {
                continue;
            }

            uniquePalettes.add(JSON.stringify(candidate.boneTransformIds));
        }

        return uniquePalettes.size > 1;
    }

    private hasCompleteWeightedBonePalette(mesh: PreparedAnimatorMesh, palette: readonly (string | null)[]): boolean {
        const boneIndices = mesh.boneIndices;
        const boneWeights = mesh.boneWeights;

        if (!boneIndices || !boneWeights)
            return true;

        for (let offset = 0; offset < boneWeights.length; offset++)
        {
            if (boneWeights[offset] <= this.WEIGHT_EPSILON)
                continue;

            const boneIndex = boneIndices[offset];

            if (boneIndex >= palette.length || palette[boneIndex] === null)
                return false;
        }

        return true;
    }

    private isCompatibleBonePalette(incomplete: readonly (string | null)[], candidate: readonly (string | null)[]): boolean {
        if (incomplete.length !== candidate.length)
            return this.isOrderedBonePaletteSubset(incomplete, candidate);

        return incomplete.every((boneTransformId, index) => boneTransformId === null || boneTransformId === candidate[index]);
    }

    private isOrderedBonePaletteSubset(subset: readonly (string | null)[], completePalette: readonly (string | null)[]): boolean {
        let subsetIndex = 0;

        for (const boneTransformId of completePalette)
        {
            if (boneTransformId === subset[subsetIndex])
                subsetIndex++;

            if (subsetIndex === subset.length)
                return true;
        }

        return subsetIndex === subset.length;
    }
}
