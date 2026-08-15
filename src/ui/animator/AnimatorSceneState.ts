import type { AnimatorRuntimeMaterial, AnimatorRuntimeScene, AnimatorRuntimeMesh, AnimatorRuntimeSkinnedMeshRenderer, AnimatorRendererType } from "./AnimatorBindingResolver";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type AnimatorTransformState = {
    localPosition: number[];
    localRotation: number[];
    localScale: number[];
};

export type AnimatorGameObjectState = {
    active: boolean;
};

export type AnimatorMaterialPropertyValue =
    | number
    | number[];

export type AnimatorMaterialPropertyOverrides =
    Map<number, Map<string, AnimatorMaterialPropertyValue>>;

export type AnimatorSkinnedMeshRendererState = {
    enabled: boolean;
    materialIds: (string | null)[];
    blendShapeWeights: number[];
    sortingOrder: number;
    materialPropertyOverrides: AnimatorMaterialPropertyOverrides;
    texturePropertyOverrides: Map<number, Map<string, string | null>>;
};

export type AnimatorSpriteRendererState = {
    enabled: boolean;
    spriteId: string | null;
    materialIds: (string | null)[];
    color: number[];
    flipX: boolean;
    flipY: boolean;
    size: number[];
    sortingOrder: number;
    materialPropertyOverrides: AnimatorMaterialPropertyOverrides;
    texturePropertyOverrides: Map<number, Map<string, string | null>>;
};

export type AnimatorParticleSystemRendererState = {
    enabled: boolean;
    materialIds: (string | null)[];
    sortingOrder: number;
    materialPropertyOverrides: AnimatorMaterialPropertyOverrides;
    texturePropertyOverrides: Map<number, Map<string, string | null>>;
};

export type AnimatorRendererState =
    | AnimatorSkinnedMeshRendererState
    | AnimatorSpriteRendererState
    | AnimatorParticleSystemRendererState;

export type AnimatorMaterialPropertyType =
    | "float"
    | "integer"
    | "vector"
    | "textureTransform";

export class AnimatorSceneState {
    private readonly materialsById: Map<string, AnimatorRuntimeMaterial>;
    private readonly meshesById: Map<string, AnimatorRuntimeMesh>;
    readonly transforms = new Map<string, AnimatorTransformState>();
    readonly gameObjects = new Map<string, AnimatorGameObjectState>();
    readonly skinnedMeshRenderers = new Map<string, AnimatorSkinnedMeshRendererState>();
    readonly spriteRenderers = new Map<string, AnimatorSpriteRendererState>();
    readonly particleSystemRenderers = new Map<string, AnimatorParticleSystemRendererState>();

    constructor(private readonly scene: AnimatorRuntimeScene) {
        this.materialsById = AnimatorRuntimeUtils.indexUniqueById(scene.materials, "Material");
        this.meshesById = AnimatorRuntimeUtils.indexUniqueById(scene.meshes, "Mesh");
        this.initialize();
    }

    reset() {
        for (const transform of this.scene.transforms)
        {
            const state = this.requireTransform(transform.id);

            AnimatorRuntimeUtils.copyFiniteVector(state.localPosition, transform.localPosition, 3, `Transform "${transform.id}" position`);
            AnimatorRuntimeUtils.copyFiniteVector(state.localRotation, transform.localRotation, 4, `Transform "${transform.id}" rotation`);
            AnimatorRuntimeUtils.copyFiniteVector(state.localScale, transform.localScale, 3, `Transform "${transform.id}" scale`);
        }

        for (const gameObject of this.scene.gameObjects)
            this.requireGameObject(gameObject.id).active = gameObject.active;

        for (const renderer of this.scene.skinnedMeshRenderers)
        {
            const state = this.requireSkinnedMeshRenderer(renderer.id);

            state.enabled = renderer.enabled;
            state.sortingOrder = renderer.sortingOrder;

            this.copyNullableStrings(state.materialIds, renderer.materialIds);

            const initialBlendShapeWeights = this.createBlendShapeWeights(renderer);

            AnimatorRuntimeUtils.copyFiniteVector(
                state.blendShapeWeights,
                initialBlendShapeWeights,
                initialBlendShapeWeights.length,
                `SkinnedMeshRenderer "${renderer.id}" blend-shape weights`
            );

            state.materialPropertyOverrides.clear();
            state.texturePropertyOverrides.clear();
        }

        for (const renderer of this.scene.spriteRenderers)
        {
            const state = this.requireSpriteRenderer(renderer.id);

            state.enabled = renderer.enabled;
            state.spriteId = renderer.spriteId;
            state.flipX = renderer.flipX;
            state.flipY = renderer.flipY;
            state.sortingOrder = renderer.sortingOrder;

            this.copyNullableStrings(state.materialIds, renderer.materialIds);
            AnimatorRuntimeUtils.copyFiniteVector(state.color, renderer.color, 4, `SpriteRenderer "${renderer.id}" color`);
            AnimatorRuntimeUtils.copyFiniteVector(state.size, renderer.size, 2, `SpriteRenderer "${renderer.id}" size`);

            state.materialPropertyOverrides.clear();
            state.texturePropertyOverrides.clear();
        }

        for (const renderer of this.scene.particleSystemRenderers)
        {
            const state = this.requireParticleSystemRenderer(renderer.id);

            state.enabled = renderer.enabled;
            state.sortingOrder = renderer.sortingOrder;

            this.copyNullableStrings(state.materialIds, renderer.materialIds);

            state.materialPropertyOverrides.clear();
            state.texturePropertyOverrides.clear();
        }
    }

    requireTransform(id: string): AnimatorTransformState {
        const state = this.transforms.get(id);
        if (!state)
            throw new Error(`Transform "${id}" does not exist in the scene state.`);

        return state;
    }

    requireGameObject(id: string): AnimatorGameObjectState {
        const state = this.gameObjects.get(id);
        if (!state)
            throw new Error(`GameObject "${id}" does not exist in the scene state.`);

        return state;
    }

    requireSkinnedMeshRenderer(id: string): AnimatorSkinnedMeshRendererState {
        const state = this.skinnedMeshRenderers.get(id);
        if (!state)
            throw new Error(`SkinnedMeshRenderer "${id}" does not exist in the scene state.`);

        return state;
    }

    requireSpriteRenderer(id: string): AnimatorSpriteRendererState {
        const state = this.spriteRenderers.get(id);
        if (!state)
            throw new Error(`SpriteRenderer "${id}" does not exist in the scene state.`);

        return state;
    }

    requireParticleSystemRenderer(id: string): AnimatorParticleSystemRendererState {
        const state = this.particleSystemRenderers.get(id);
        if (!state)
            throw new Error(`ParticleSystemRenderer "${id}" does not exist in the scene state.`);

        return state;
    }

    requireRenderer(id: string, type: AnimatorRendererType): AnimatorRendererState {
        switch (type)
        {
            case "SkinnedMeshRenderer":
                return this.requireSkinnedMeshRenderer(id);
            case "SpriteRenderer":
                return this.requireSpriteRenderer(id);
            case "ParticleSystemRenderer":
                return this.requireParticleSystemRenderer(id);
        }
    }

    getMaterialPropertyValue(
        rendererId: string,
        rendererType: AnimatorRendererType,
        materialSlot: number,
        propertyName: string,
        propertyType: AnimatorMaterialPropertyType
    ): AnimatorMaterialPropertyValue | null {
        const renderer = this.requireRenderer(rendererId, rendererType);

        AnimatorRuntimeUtils.requireMaterialSlot(renderer, materialSlot);

        const override = renderer.materialPropertyOverrides
            .get(materialSlot)
            ?.get(propertyName);

        if (override !== undefined)
            return this.cloneMaterialValue(override);

        const materialId = renderer.materialIds[materialSlot];
        if (!materialId)
            return null;

        const material = this.materialsById.get(materialId);
        if (!material)
            return null;

        switch (propertyType)
        {
            case "float":
                return material.floatProperties.find((property) => property.name === propertyName)?.value ?? null;

            case "integer":
                return material.intProperties.find((property) => property.name === propertyName)?.value ?? null;

            case "vector": {
                const value = material.colorProperties.find((property) => property.name === propertyName)?.value;

                return value
                    ? [...AnimatorRuntimeUtils.requireFiniteVector(value, 4, `Material "${material.id}" property "${propertyName}"`)]
                    : null;
            }

            case "textureTransform": {
                if (!propertyName.endsWith("_ST"))
                    return null;

                const texturePropertyName = propertyName.slice(0, -3);
                const property = material.textureProperties.find((candidate) =>  candidate.name === texturePropertyName);

                if (!property)
                    return null;

                const scale = [...AnimatorRuntimeUtils.requireFiniteVector(property.scale, 2, `Material "${material.id}" property "${propertyName}" scale`)];
                const offset = [...AnimatorRuntimeUtils.requireFiniteVector(property.offset, 2, `Material "${material.id}" property "${propertyName}" offset`)];

                return [
                    scale[0],
                    scale[1],
                    offset[0],
                    offset[1]
                ];
            }
        }
    }

    setMaterialPropertyOverride(
        rendererId: string,
        rendererType: AnimatorRendererType,
        materialSlot: number,
        propertyName: string,
        value: AnimatorMaterialPropertyValue
    ) {
        const renderer = this.requireRenderer(rendererId, rendererType);

        AnimatorRuntimeUtils.requireMaterialSlot(renderer, materialSlot);

        let properties = renderer.materialPropertyOverrides.get(materialSlot);

        if (!properties)
        {
            properties = new Map();
            renderer.materialPropertyOverrides.set(materialSlot, properties);
        }

        properties.set(propertyName, this.cloneMaterialValue(value));
    }

    getMaterialTextureId(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, propertyName: string): string | null {
        const renderer = this.requireRenderer(rendererId, rendererType);
        AnimatorRuntimeUtils.requireMaterialSlot(renderer, materialSlot);

        const slotOverrides = renderer.texturePropertyOverrides.get(materialSlot);
        if (slotOverrides?.has(propertyName))
            return slotOverrides.get(propertyName) ?? null;

        const materialId = renderer.materialIds[materialSlot];
        if (!materialId)
            return null;

        const material = this.materialsById.get(materialId);
        if (!material)
            return null;

        return material.textureProperties.find((property) => property.name === propertyName)?.textureId ?? null;
    }

    setMaterialTextureOverride(rendererId: string, rendererType: AnimatorRendererType, materialSlot: number, propertyName: string, textureId: string | null) {
        const renderer = this.requireRenderer(rendererId, rendererType);

        AnimatorRuntimeUtils.requireMaterialSlot(renderer, materialSlot);

        let properties = renderer.texturePropertyOverrides.get(materialSlot);

        if (!properties)
        {
            properties = new Map();
            renderer.texturePropertyOverrides.set(materialSlot, properties);
        }

        properties.set(propertyName, textureId);
    }

    private initialize() {
        for (const transform of this.scene.transforms)
        {
            if (this.transforms.has(transform.id))
                throw new Error(`Transform "${transform.id}" is duplicated.`);

            this.transforms.set(transform.id, {
                localPosition: [...AnimatorRuntimeUtils.requireFiniteVector(transform.localPosition, 3, `Transform "${transform.id}" position`)],
                localRotation: [...AnimatorRuntimeUtils.requireFiniteVector(transform.localRotation, 4, `Transform "${transform.id}" rotation`)],
                localScale: [...AnimatorRuntimeUtils.requireFiniteVector(transform.localScale, 3, `Transform "${transform.id}" scale`)]
            });
        }

        for (const gameObject of this.scene.gameObjects)
        {
            if (this.gameObjects.has(gameObject.id))
                throw new Error(`GameObject "${gameObject.id}" is duplicated.`);

            this.gameObjects.set(gameObject.id, {
                active: gameObject.active
            });
        }

        for (const renderer of this.scene.skinnedMeshRenderers)
        {
            if (this.skinnedMeshRenderers.has(renderer.id))
                throw new Error(`SkinnedMeshRenderer "${renderer.id}" is duplicated.`);

            this.skinnedMeshRenderers.set(renderer.id, {
                enabled: renderer.enabled,
                materialIds: [...renderer.materialIds],
                blendShapeWeights: this.createBlendShapeWeights(renderer),
                sortingOrder: renderer.sortingOrder,
                materialPropertyOverrides: new Map(),
                texturePropertyOverrides: new Map()
            });
        }

        for (const renderer of this.scene.spriteRenderers)
        {
            if (this.spriteRenderers.has(renderer.id))
                throw new Error( `SpriteRenderer "${renderer.id}" is duplicated.`);

            this.spriteRenderers.set(renderer.id, {
                enabled: renderer.enabled,
                spriteId: renderer.spriteId,
                materialIds: [...renderer.materialIds],
                color: [...AnimatorRuntimeUtils.requireFiniteVector(renderer.color, 4, `SpriteRenderer "${renderer.id}" color`)],
                flipX: renderer.flipX,
                flipY: renderer.flipY,
                size: [...AnimatorRuntimeUtils.requireFiniteVector(renderer.size, 2, `SpriteRenderer "${renderer.id}" size`)],
                sortingOrder: renderer.sortingOrder,
                materialPropertyOverrides: new Map(),
                texturePropertyOverrides: new Map()
            });
        }

        for (const renderer of this.scene.particleSystemRenderers)
        {
            if (this.particleSystemRenderers.has(renderer.id))
                throw new Error(`ParticleSystemRenderer "${renderer.id}" is duplicated.`);

            this.particleSystemRenderers.set(renderer.id, {
                enabled: renderer.enabled,
                materialIds: [...renderer.materialIds],
                sortingOrder: renderer.sortingOrder,
                materialPropertyOverrides: new Map(),
                texturePropertyOverrides: new Map()
            });
        }
    }

    private createBlendShapeWeights(renderer: AnimatorRuntimeSkinnedMeshRenderer): number[] {
        const serializedWeights = [...AnimatorRuntimeUtils.requireFiniteVector(
            renderer.blendShapeWeights, renderer.blendShapeWeights.length,
            `SkinnedMeshRenderer "${renderer.id}" blend-shape weights`
        )];

        if (!renderer.meshId)
            return serializedWeights;

        const mesh = this.meshesById.get(renderer.meshId);
        if (!mesh)
            throw new Error(`SkinnedMeshRenderer "${renderer.id}" references a missing Mesh.`);

        const requiredLength = Math.max(serializedWeights.length, mesh.blendShapes.length);
        if (serializedWeights.length === requiredLength)
            return serializedWeights;

        const result = Array<number>(requiredLength).fill(0);

        for (let i = 0; i < serializedWeights.length; i++)
            result[i] = serializedWeights[i];

        return result;
    }

    private copyNullableStrings(destination: (string | null)[], source: readonly (string | null)[]) {
        destination.length = source.length;

        for (let i = 0; i < source.length; i++)
            destination[i] = source[i];
    }

    private cloneMaterialValue(value: AnimatorMaterialPropertyValue): AnimatorMaterialPropertyValue {
        return Array.isArray(value)
            ? [...value]
            : value;
    }
}
