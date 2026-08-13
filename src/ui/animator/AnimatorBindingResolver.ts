import type { AnimatorFloat32GeometryDefinition, AnimatorUint16GeometryDefinition, AnimatorUint32GeometryDefinition } from "./AnimatorGeometryReader";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";
import { UnityCrc32 } from "@/utils/UnityCrc32";

export type AnimatorRuntimeComponent = Readonly<{
    id: string;
    type: string;
}>;

export type AnimatorRuntimeGameObject = Readonly<{
    id: string;
    name: string;
    active: boolean;
    components: readonly AnimatorRuntimeComponent[];
}>;

export type AnimatorRuntimeTransform = Readonly<{
    id: string;
    gameObjectId: string;
    parentId: string | null;
    relativePath: string;
    localPosition: readonly number[];
    localRotation: readonly number[];
    localScale: readonly number[];
    children: readonly string[];
}>;

export type AnimatorRuntimeTextureProperty = Readonly<{
    name: string;
    textureId: string | null;
    scale: readonly number[];
    offset: readonly number[];
}>;

export type AnimatorRuntimeFloatProperty = Readonly<{
    name: string;
    value: number;
}>;

export type AnimatorRuntimeIntegerProperty = Readonly<{
    name: string;
    value: number;
}>;

export type AnimatorRuntimeColorProperty = Readonly<{
    name: string;
    value: readonly number[];
}>;

export type AnimatorRuntimeAnimator = Readonly<{
    id: string;
    gameObjectId: string;
    controllerId: string | null;
}>;

export type AnimatorRuntimeBlendShapeFrame = Readonly<{
    weight: number;
    indices: AnimatorUint32GeometryDefinition | null;
    positions: AnimatorFloat32GeometryDefinition | null;
    normals: AnimatorFloat32GeometryDefinition | null;
    tangents: AnimatorFloat32GeometryDefinition | null;
}>;

export type AnimatorRuntimeBlendShape = Readonly<{
    name: string;
    nameHash: number;
    frames: readonly AnimatorRuntimeBlendShapeFrame[];
}>;

export type AnimatorRuntimeSubmesh = Readonly<{
    materialSlot: number;
    indexStart: number;
    indexCount: number;
    baseVertex: number;
    topology: number;
}>;

export type AnimatorRuntimeMesh = Readonly<{
    id: string;
    name: string;
    vertexCount: number;
    positions: AnimatorFloat32GeometryDefinition;
    normals: AnimatorFloat32GeometryDefinition | null;
    uv0: AnimatorFloat32GeometryDefinition | null;
    boneIndices: AnimatorUint16GeometryDefinition | null;
    boneWeights: AnimatorFloat32GeometryDefinition | null;
    indices: AnimatorUint32GeometryDefinition | null;
    bindPoses: AnimatorFloat32GeometryDefinition | null;
    submeshes: readonly AnimatorRuntimeSubmesh[];
    blendShapes: readonly AnimatorRuntimeBlendShape[];
}>;

export type AnimatorRuntimeMaterial = Readonly<{
    id: string;
    name: string;
    shaderId: string | null;
    renderQueue: number;
    textureProperties: readonly AnimatorRuntimeTextureProperty[];
    floatProperties: readonly AnimatorRuntimeFloatProperty[];
    intProperties: readonly AnimatorRuntimeIntegerProperty[];
    colorProperties: readonly AnimatorRuntimeColorProperty[];
}>;

export type AnimatorRuntimePuppet2DIkHandle = Readonly<{
    componentId: string;
    enabled: boolean;
    controlTransformId: string;
    poleTransformId: string;
    topJointTransformId: string;
    middleJointTransformId: string;
    bottomJointTransformId: string;
    flip: boolean;
    squashAndStretch: boolean;
    scaleBottomJoint: boolean;
    aimDirection: readonly number[];
    upDirection: readonly number[];
    scaleStart: readonly (readonly number[])[];
    offsetScale: readonly number[];
    offsetRotation: readonly number[];
}>;

export type AnimatorRuntimeParticleValue =
    | null
    | boolean
    | number
    | string
    | readonly AnimatorRuntimeParticleValue[]
    | Readonly<{ [key: string]: AnimatorRuntimeParticleValue }>;

export type AnimatorRuntimeParticleSystem = Readonly<{
    id: string;
    gameObjectId: string;
    length: number;
    simulationSpeed: number;
    looping: boolean;
    prewarm: boolean;
    playOnAwake: boolean;
    useUnscaledTime: boolean;
    autoRandomSeed: boolean;
    randomSeed: number;
    moveWithTransform: number;
    scalingMode: number;
    startDelay: AnimatorRuntimeParticleValue;
    modules: Readonly<Record<string, AnimatorRuntimeParticleValue>>;
}>;

export type AnimatorRuntimeParticleSystemRenderer = Readonly<{
    id: string;
    gameObjectId: string;
    particleSystemId: string;
    enabled: boolean;
    materialIds: readonly (string | null)[];
    sortingLayerId: number;
    sortingOrder: number;
    renderMode: number;
    sortMode: number;
    renderAlignment: number;
    minimumParticleSize: number;
    maximumParticleSize: number;
    velocityScale: number;
    lengthScale: number;
    sortingFudge: number;
    pivot: readonly number[];
    flip: readonly number[];
}>;

export type AnimatorRuntimeRectangle = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

export type AnimatorRuntimeSpriteMesh = Readonly<{
    positions: AnimatorFloat32GeometryDefinition;
    uv0: AnimatorFloat32GeometryDefinition | null;
    indices: AnimatorUint32GeometryDefinition;
}>;

export type AnimatorRuntimeSprite = Readonly<{
    id: string;
    name: string;
    textureId: string | null;
    alphaTextureId: string | null;
    rect: AnimatorRuntimeRectangle;
    textureRect: AnimatorRuntimeRectangle;
    textureRectOffset: readonly number[];
    pivot: readonly number[];
    pixelsPerUnit: number;
    packingSettings: number;
    mesh: AnimatorRuntimeSpriteMesh | null;
}>;

export type AnimatorRuntimeBounds = Readonly<{
    center: readonly number[];
    extent: readonly number[];
}>;

export type AnimatorRuntimeSkinnedMeshRenderer = Readonly<{
    id: string;
    gameObjectId: string;
    enabled: boolean;
    meshId: string | null;
    materialIds: readonly (string | null)[];
    boneTransformIds: readonly (string | null)[];
    rootBoneTransformId: string | null;
    blendShapeWeights: readonly number[];
    sortingLayerId: number;
    sortingOrder: number;
    bounds: AnimatorRuntimeBounds;
}>;

export type AnimatorRuntimeSpriteRenderer = Readonly<{
    id: string;
    gameObjectId: string;
    enabled: boolean;
    spriteId: string | null;
    materialIds: readonly (string | null)[];
    color: readonly number[];
    flipX: boolean;
    flipY: boolean;
    size: readonly number[];
    sortingLayerId: number;
    sortingOrder: number;
}>;

export type AnimatorRuntimeScene = Readonly<{
    transforms: readonly AnimatorRuntimeTransform[];
    gameObjects: readonly AnimatorRuntimeGameObject[];
    animators: readonly AnimatorRuntimeAnimator[];
    meshes: readonly AnimatorRuntimeMesh[];
    materials: readonly AnimatorRuntimeMaterial[];
    sprites: readonly AnimatorRuntimeSprite[];
    skinnedMeshRenderers: readonly AnimatorRuntimeSkinnedMeshRenderer[];
    spriteRenderers: readonly AnimatorRuntimeSpriteRenderer[];
    interactions: AnimatorRuntimeInteractions;
    puppet2dIkHandles: readonly AnimatorRuntimePuppet2DIkHandle[];
    particleSystems: readonly AnimatorRuntimeParticleSystem[];
    particleSystemRenderers: readonly AnimatorRuntimeParticleSystemRenderer[];
}>;

export type AnimatorObjectReference = Readonly<{
    fileId: number;
    pathId: string;
    type: string;
    className: string | null;
}> | null;

export type AnimatorBindingDefinition = Readonly<{
    bindingIndex: number;
    scalarStart: number;
    scalarCount: number;
    components: readonly string[];
    pathHash: number;
    attributeHash: number;
    typeId: number;
    customType: number;
    isPPtrCurve: boolean;
    script: AnimatorObjectReference;
}>;

export type AnimatorBindingClip = Readonly<{
    name: string;
    bindings: readonly AnimatorBindingDefinition[];
    pptrCurveMapping: readonly AnimatorObjectReference[];
}>;

export type ResolvedAnimatorObjectReference =
    | Readonly<{
        kind: "material";
        materialId: string;
    }>
    | Readonly<{
        kind: "sprite";
        spriteId: string;
    }>;

export type AnimatorRuntimeHitbox = Readonly<{
    id: string;
    type: "BoxCollider" | "BoxCollider2D";
    gameObjectId: string;
    enabled: boolean;
    center: readonly number[];
    size: readonly number[];
}>;

export type AnimatorRuntimeActorInteractions = Readonly<{
    componentId: string;
    gameObjectId: string;
    face: Readonly<{
        rendererId: string;
        names: readonly string[];
    }>;
    hitboxes: Readonly<{
        touch: AnimatorRuntimeHitbox | null;
        specialTouch: readonly AnimatorRuntimeHitbox[];
    }>;
}>;

export type AnimatorRuntimeMaterialRPlusBinding = Readonly<{
    rendererId: string;
    materialIndex: number;
    materialId: string;
    texturePropertyName: string;
    originTextureId: string | null;
    rplusTextureId: string | null;
}>;

export type AnimatorRuntimeMaterialRPlusSwitcher = Readonly<{
    componentId: string;
    bindings: readonly AnimatorRuntimeMaterialRPlusBinding[];
}>;

export type AnimatorRuntimeSpriteRPlusBinding = Readonly<{
    rendererId: string;
    originSpriteId: string | null;
    rplusSpriteId: string | null;
}>;

export type AnimatorRuntimeSpriteRPlusSwitcher = Readonly<{
    componentId: string;
    bindings: readonly AnimatorRuntimeSpriteRPlusBinding[];
}>;

export type AnimatorRuntimeMosaic = Readonly<{
    componentId: string;
    gameObjectId: string;
    rendererId: string;
    enabled: boolean;
    referenceScreenSize: number;
    minMultiplier: number;
    maxMultiplier: number;
}>;

export type AnimatorRuntimeInteractions = Readonly<{
    actor: AnimatorRuntimeActorInteractions;
    rplus: Readonly<{
        materialSwitchers: readonly AnimatorRuntimeMaterialRPlusSwitcher[];
        spriteSwitchers: readonly AnimatorRuntimeSpriteRPlusSwitcher[];
    }>;
    mosaics: readonly AnimatorRuntimeMosaic[];
}>;

export type ResolvedAnimatorProperty =
    | Readonly<{
        kind: "gameObjectActive";
    }>
    | Readonly<{
        kind: "transform";
        property: "position" | "rotation" | "scale" | "euler";
    }>
    | Readonly<{
        kind: "rendererEnabled";
        rendererId: string;
        rendererType: "SkinnedMeshRenderer" | "SpriteRenderer";
    }>
    | Readonly<{
        kind: "rendererSortingOrder";
        rendererId: string;
        rendererType: "SkinnedMeshRenderer" | "SpriteRenderer";
    }>
    | Readonly<{
        kind: "spriteRendererColor";
        rendererId: string;
        component: "r" | "g" | "b" | "a";
    }>
    | Readonly<{
        kind: "spriteRendererFlip";
        rendererId: string;
        axis: "x" | "y";
    }>
    | Readonly<{
        kind: "spriteRendererSize";
        rendererId: string;
        component: "x" | "y";
    }>
    | Readonly<{
        kind: "blendShape";
        rendererId: string;
        meshId: string;
        blendShapeIndex: number;
        blendShapeName: string;
    }>
    | Readonly<{
        kind: "materialProperty";
        rendererId: string;
        rendererType: "SkinnedMeshRenderer" | "SpriteRenderer";
        propertyName: string;
        propertyType: "float" | "integer" | "vector" | "textureTransform";
        component: "x" | "y" | "z" | "w" | "r" | "g" | "b" | "a" | null;
        materialSlots: readonly number[];
    }>
    | Readonly<{
        kind: "materialReference";
        rendererId: string;
        rendererType: "SkinnedMeshRenderer" | "SpriteRenderer";
        materialSlot: number;
    }>
    | Readonly<{
        kind: "spriteReference";
        rendererId: string;
    }>;

export type ResolvedAnimatorBinding = Readonly<{
    bindingIndex: number;
    scalarStart: number;
    scalarCount: number;
    components: readonly string[];
    targetTransformId: string;
    targetGameObjectId: string;
    property: ResolvedAnimatorProperty;
}>;

export type AnimatorBindingDiagnostic = Readonly<{
    clipName: string;
    bindingIndex: number | null;
    mappingIndex: number | null;
    message: string;
}>;

export type AnimatorBindingResolution = Readonly<{
    bindings: readonly (ResolvedAnimatorBinding | null)[];
    objectReferences: readonly (ResolvedAnimatorObjectReference | null)[];
    diagnostics: readonly AnimatorBindingDiagnostic[];
}>;

type RendererTarget = Readonly<{
    rendererId: string;
    rendererType: "SkinnedMeshRenderer" | "SpriteRenderer";
    materialIds: readonly (string | null)[];
    meshId: string | null;
}>;

type MaterialCandidate = {
    propertyName: string;
    propertyType: "float" | "integer" | "vector" | "textureTransform";
    materialSlots: Set<number>;
};

class BindingResolutionError extends Error {}
class IgnoredBindingResolutionError extends BindingResolutionError {}

export class AnimatorBindingResolver {
    private readonly GAME_OBJECT_TYPE_ID = 1;
    private readonly TRANSFORM_TYPE_ID = 4;
    private readonly MESH_RENDERER_TYPE_ID = 23;
    private readonly MONO_BEHAVIOUR_TYPE_ID = 114;
    private readonly SKINNED_MESH_RENDERER_TYPE_ID = 137;
    private readonly PARTICLE_SYSTEM_TYPE_ID = 198;
    private readonly PARTICLE_SYSTEM_RENDERER_TYPE_ID = 199;
    private readonly SPRITE_RENDERER_TYPE_ID = 212;
    private readonly CUSTOM_BLEND_SHAPE = 20;
    private readonly CUSTOM_RENDERER_MATERIAL_REFERENCE = 21;
    private readonly CUSTOM_RENDERER_MATERIAL_PROPERTY = 22;
    private readonly CUSTOM_SPRITE_REFERENCE = 23;
    private readonly CUSTOM_MONO_BEHAVIOUR = 24;
    private readonly CUSTOM_RENDERER_PROPERTY = 26;
    private readonly CUSTOM_PARTICLE_SYSTEM = 27;
    private readonly HASH_IS_ACTIVE = UnityCrc32.generateCrc("m_IsActive");
    private readonly HASH_ENABLED = UnityCrc32.generateCrc("m_Enabled");
    private readonly HASH_SORTING_ORDER = UnityCrc32.generateCrc("m_SortingOrder");
    private readonly SPRITE_COLOR_COMPONENTS = new Map<number, "r" | "g" | "b" | "a">([
        [UnityCrc32.generateCrc("m_Color.r"), "r"],
        [UnityCrc32.generateCrc("m_Color.g"), "g"],
        [UnityCrc32.generateCrc("m_Color.b"), "b"],
        [UnityCrc32.generateCrc("m_Color.a"), "a"]
    ]);
    private readonly SPRITE_SIZE_COMPONENTS = new Map<number, "x" | "y">([
        [UnityCrc32.generateCrc("m_Size.x"), "x"],
        [UnityCrc32.generateCrc("m_Size.y"), "y"]
    ]);
    private readonly transformsById: Map<string, AnimatorRuntimeTransform>;
    private readonly transformsByGameObjectId: Map<string, AnimatorRuntimeTransform>;
    private readonly gameObjectsById: Map<string, AnimatorRuntimeGameObject>;
    private readonly meshesById: Map<string, AnimatorRuntimeMesh>;
    private readonly materialsById: Map<string, AnimatorRuntimeMaterial>;
    private readonly spritesById: Map<string, AnimatorRuntimeSprite>;
    private readonly skinnedRenderersByGameObjectId: Map<string, AnimatorRuntimeSkinnedMeshRenderer[]>;
    private readonly spriteRenderersByGameObjectId: Map<string, AnimatorRuntimeSpriteRenderer[]>;

    constructor(private readonly scene: AnimatorRuntimeScene) {
        this.transformsById = AnimatorRuntimeUtils.indexUniqueById(scene.transforms, "Transform");
        this.transformsByGameObjectId = this.indexTransformsByGameObject();
        this.gameObjectsById = AnimatorRuntimeUtils.indexUniqueById(scene.gameObjects, "GameObject");
        this.meshesById = AnimatorRuntimeUtils.indexUniqueById(scene.meshes, "Mesh");
        this.materialsById = AnimatorRuntimeUtils.indexUniqueById(scene.materials, "Material");
        this.spritesById = AnimatorRuntimeUtils.indexUniqueById(scene.sprites, "Sprite");
        this.skinnedRenderersByGameObjectId = this.groupByGameObject(scene.skinnedMeshRenderers);
        this.spriteRenderersByGameObjectId = this.groupByGameObject(scene.spriteRenderers);
    }

    resolve(animatorId: string, clip: AnimatorBindingClip): AnimatorBindingResolution {
        const animator = this.scene.animators.find((candidate) => candidate.id === animatorId);
        if (!animator)
            throw new Error(`Animator "${animatorId}" does not exist in the runtime scene.`);

        const targetsByHash = this.buildPathIndex(animator);
        const bindings: (ResolvedAnimatorBinding | null)[] = Array.from({ length: clip.bindings.length }, () => null);
        const diagnostics: AnimatorBindingDiagnostic[] = [];
        const usedBindingIndices = new Set<number>();

        for (const binding of clip.bindings)
        {
            if (
                !Number.isInteger(binding.bindingIndex) ||
                binding.bindingIndex < 0 ||
                binding.bindingIndex >= bindings.length ||
                usedBindingIndices.has(binding.bindingIndex)
            )
            {
                throw new Error(`AnimationClip "${clip.name}" has an invalid binding index.`);
            }

            usedBindingIndices.add(binding.bindingIndex);

            try
            {
                const target = this.requireTarget(targetsByHash, binding.pathHash, clip.name, binding.bindingIndex);

                bindings[binding.bindingIndex] = {
                    bindingIndex: binding.bindingIndex,
                    scalarStart: binding.scalarStart,
                    scalarCount: binding.scalarCount,
                    components: binding.components,
                    targetTransformId: target.id,
                    targetGameObjectId: target.gameObjectId,
                    property: this.resolveProperty(target, binding)
                };
            }
            catch (error)
            {
                if (error instanceof IgnoredBindingResolutionError)
                    continue;

                if (!(error instanceof BindingResolutionError))
                    throw error;

                diagnostics.push({
                    clipName: clip.name,
                    bindingIndex: binding.bindingIndex,
                    mappingIndex: null,
                    message: error.message
                });
            }
        }

        const objectReferences = clip.pptrCurveMapping.map((reference, mappingIndex) => {
            if (reference === null)
                return null;

            try
            {
                return this.resolveObjectReference(reference);
            }
            catch (error)
            {
                if (!(error instanceof BindingResolutionError))
                    throw error;

                diagnostics.push({
                    clipName: clip.name,
                    bindingIndex: null,
                    mappingIndex,
                    message: error.message
                });

                return null;
            }
        });

        return {
            bindings,
            objectReferences,
            diagnostics
        };
    }

    private resolveProperty(target: AnimatorRuntimeTransform, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        const attribute = binding.attributeHash >>> 0;

        if (binding.typeId === this.TRANSFORM_TYPE_ID)
        {
            if (binding.isPPtrCurve || ![0, 4].includes(binding.customType))
                throw new BindingResolutionError("The Transform binding uses an unsupported curve type.");

            const property = new Map<number, "position" | "rotation" | "scale" | "euler">([
                [1, "position"],
                [2, "rotation"],
                [3, "scale"],
                [4, "euler"]
            ]).get(attribute);

            if (!property)
                throw new BindingResolutionError(`Unknown Transform attribute ${attribute}.`);

            return { kind: "transform", property };
        }

        if (binding.typeId === this.GAME_OBJECT_TYPE_ID && binding.customType === 0 && !binding.isPPtrCurve && attribute === this.HASH_IS_ACTIVE)
            return { kind: "gameObjectActive" };

        if (binding.customType === this.CUSTOM_BLEND_SHAPE)
            return this.resolveBlendShape(target.gameObjectId, binding);

        if (binding.customType === this.CUSTOM_RENDERER_MATERIAL_REFERENCE)
            return this.resolveMaterialReference(target.gameObjectId, binding);

        if (binding.customType === this.CUSTOM_RENDERER_MATERIAL_PROPERTY)
            return this.resolveMaterialProperty(target.gameObjectId, binding);

        if (binding.customType === this.CUSTOM_SPRITE_REFERENCE)
            return this.resolveSpriteReference(target.gameObjectId, binding);

        if (binding.customType === this.CUSTOM_RENDERER_PROPERTY)
            return this.resolveRendererProperty(target.gameObjectId, binding);

        if (binding.typeId === this.SKINNED_MESH_RENDERER_TYPE_ID && binding.customType === 0 && !binding.isPPtrCurve && attribute === this.HASH_ENABLED)
        {
            const renderer = this.requireRenderer(target.gameObjectId, this.SKINNED_MESH_RENDERER_TYPE_ID);

            return {
                kind: "rendererEnabled",
                rendererId: renderer.rendererId,
                rendererType: renderer.rendererType
            };
        }

        if (binding.typeId === this.SPRITE_RENDERER_TYPE_ID && binding.customType === 0)
            return this.resolveSpriteRendererProperty(target.gameObjectId, binding);

        if (binding.typeId === this.MONO_BEHAVIOUR_TYPE_ID || binding.customType === this.CUSTOM_MONO_BEHAVIOUR)
        {
            if (binding.script?.type === "MonoScript" && binding.script.className === "DynamicBone")
                throw new IgnoredBindingResolutionError("DynamicBone animation fields are intentionally ignored.");

            throw new BindingResolutionError("MonoBehaviour animation fields are not exported by the current runtime package.");
        }

        if (binding.typeId === this.PARTICLE_SYSTEM_TYPE_ID || binding.customType === this.CUSTOM_PARTICLE_SYSTEM)
            throw new BindingResolutionError("ParticleSystem animation fields are not supported yet.");

        throw new BindingResolutionError(`Unsupported binding type ${binding.typeId}, custom type ${binding.customType}, attribute ${attribute}.`);
    }

    private resolveSpriteRendererProperty(gameObjectId: string, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        if (binding.isPPtrCurve)
            throw new BindingResolutionError("The SpriteRenderer property unexpectedly uses an object-reference curve.");

        const renderer = this.requireRenderer(gameObjectId, this.SPRITE_RENDERER_TYPE_ID);
        const attribute = binding.attributeHash >>> 0;

        if (attribute === this.HASH_ENABLED)
        {
            return {
                kind: "rendererEnabled",
                rendererId: renderer.rendererId,
                rendererType: renderer.rendererType
            };
        }

        const colorComponent = this.SPRITE_COLOR_COMPONENTS.get(attribute);
        if (colorComponent)
        {
            return {
                kind: "spriteRendererColor",
                rendererId: renderer.rendererId,
                component: colorComponent
            };
        }

        if (attribute === UnityCrc32.generateCrc("m_FlipX") || attribute === UnityCrc32.generateCrc("m_FlipY"))
        {
            return {
                kind: "spriteRendererFlip",
                rendererId: renderer.rendererId,
                axis: attribute === UnityCrc32.generateCrc("m_FlipX") ? "x" : "y"
            };
        }

        const sizeComponent = this.SPRITE_SIZE_COMPONENTS.get(attribute);
        if (sizeComponent)
        {
            return {
                kind: "spriteRendererSize",
                rendererId: renderer.rendererId,
                component: sizeComponent
            };
        }

        throw new BindingResolutionError(`Unsupported SpriteRenderer attribute ${attribute}.`);
    }

    private resolveRendererProperty(gameObjectId: string, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        if (binding.isPPtrCurve)
            throw new BindingResolutionError("The renderer property unexpectedly uses an object-reference curve.");
        if ((binding.attributeHash >>> 0) !== this.HASH_SORTING_ORDER)
            throw new BindingResolutionError(`Unsupported renderer attribute ${binding.attributeHash >>> 0}.`);

        const renderer = this.requireRenderer(gameObjectId, binding.typeId);

        return {
            kind: "rendererSortingOrder",
            rendererId: renderer.rendererId,
            rendererType: renderer.rendererType
        };
    }

    private resolveBlendShape(gameObjectId: string, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        if (binding.typeId !== this.SKINNED_MESH_RENDERER_TYPE_ID || binding.isPPtrCurve)
            throw new BindingResolutionError("The blend-shape binding has an invalid target.");

        const renderer = this.requireRenderer(gameObjectId, this.SKINNED_MESH_RENDERER_TYPE_ID);
        if (!renderer.meshId)
            throw new BindingResolutionError("The animated SkinnedMeshRenderer has no Mesh.");

        const mesh = this.meshesById.get(renderer.meshId);
        if (!mesh)
            throw new BindingResolutionError("The animated Mesh is missing from the runtime scene.");

        const attribute = binding.attributeHash >>> 0;
        const matches = mesh.blendShapes
            .map((shape, index) => ({ shape, index }))
            .filter(({ shape }) => (shape.nameHash >>> 0) === attribute);

        if (matches.length === 0 && this.isStaleNumberedBlendShapeBinding(mesh, attribute))
            throw new IgnoredBindingResolutionError(`Blend shape ${attribute} references a stale numbered channel on Mesh "${mesh.name}".`);

        if (matches.length !== 1)
        {
            throw new BindingResolutionError(
                matches.length === 0
                    ? `Blend shape ${attribute} could not be resolved on Mesh "${mesh.name}".`
                    : `Blend shape ${attribute} is ambiguous on Mesh "${mesh.name}".`
            );
        }

        const match = matches[0];

        return {
            kind: "blendShape",
            rendererId: renderer.rendererId,
            meshId: mesh.id,
            blendShapeIndex: match.index,
            blendShapeName: match.shape.name
        };
    }

    private resolveMaterialReference(gameObjectId: string, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        if (!binding.isPPtrCurve)
            throw new BindingResolutionError("The material reference does not use an object-reference curve.");

        const renderer = this.requireRenderer(gameObjectId, binding.typeId);
        const materialSlot = binding.attributeHash;

        if (!Number.isInteger(materialSlot) || materialSlot < 0 || materialSlot >= renderer.materialIds.length)
            throw new BindingResolutionError("The material reference targets an invalid material slot.");

        return {
            kind: "materialReference",
            rendererId: renderer.rendererId,
            rendererType: renderer.rendererType,
            materialSlot
        };
    }

    private resolveSpriteReference(gameObjectId: string, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        if (binding.typeId !== this.SPRITE_RENDERER_TYPE_ID || !binding.isPPtrCurve || binding.attributeHash !== 0)
            throw new BindingResolutionError("The Sprite reference binding is invalid.");

        const renderer = this.requireRenderer(gameObjectId, this.SPRITE_RENDERER_TYPE_ID);

        return {
            kind: "spriteReference",
            rendererId: renderer.rendererId
        };
    }

    private resolveMaterialProperty(gameObjectId: string, binding: AnimatorBindingDefinition): ResolvedAnimatorProperty {
        if (binding.isPPtrCurve)
            throw new BindingResolutionError("The material property unexpectedly uses an object-reference curve.");

        const renderer = this.requireRenderer(gameObjectId, binding.typeId);
        const attribute = binding.attributeHash >>> 0;
        const propertyHash = attribute & 0x0fffffff;
        const isScalar = (attribute & 0x80000000) !== 0;
        const candidates = new Map<string, MaterialCandidate>();

        const addCandidate = (propertyName: string, propertyType: MaterialCandidate["propertyType"], materialSlot: number) => {
            if ((UnityCrc32.generateCrc(propertyName) & 0x0fffffff) !== propertyHash)
                return;

            const scalarProperty = propertyType === "float" || propertyType === "integer";
            if (scalarProperty !== isScalar)
                return;

            const key = `${propertyType}\0${propertyName}`;
            let candidate = candidates.get(key);

            if (!candidate)
            {
                candidate = {
                    propertyName,
                    propertyType,
                    materialSlots: new Set()
                };

                candidates.set(key, candidate);
            }

            candidate.materialSlots.add(materialSlot);
        };

        renderer.materialIds.forEach((materialId, materialSlot) => {
            if (!materialId)
                return;

            const material = this.materialsById.get(materialId);
            if (!material)
                return;

            for (const property of material.floatProperties)
                addCandidate(property.name, "float", materialSlot);

            for (const property of material.intProperties)
                addCandidate(property.name, "integer", materialSlot);

            for (const property of material.colorProperties)
                addCandidate(property.name, "vector", materialSlot);

            for (const property of material.textureProperties)
                addCandidate(`${property.name}_ST`, "textureTransform", materialSlot);
        });

        if (candidates.size !== 1)
        {
            throw new BindingResolutionError(
                candidates.size === 0
                    ? `Material property ${propertyHash} could not be resolved.`
                    : `Material property ${propertyHash} is ambiguous.`
            );
        }

        const candidate = candidates.values().next().value as MaterialCandidate;
        const resolvedComponent = isScalar
            ? null
            : (
                (attribute & 0x40000000) !== 0
                    ? (["r", "g", "b", "a"] as const)
                    : (["x", "y", "z", "w"] as const)
            )[(attribute >>> 28) & 3];

        return {
            kind: "materialProperty",
            rendererId: renderer.rendererId,
            rendererType: renderer.rendererType,
            propertyName: candidate.propertyName,
            propertyType: candidate.propertyType,
            component: resolvedComponent,
            materialSlots: [...candidate.materialSlots].sort((left, right) => left - right)
        };
    }

    private resolveObjectReference(reference: Exclude<AnimatorObjectReference, null>): ResolvedAnimatorObjectReference {
        if (reference.fileId !== 0)
            throw new BindingResolutionError(`External ${reference.type} object references are not supported.`);

        if (reference.type === "Material")
        {
            if (!this.materialsById.has(reference.pathId))
                throw new BindingResolutionError("An animated Material is missing from the runtime package.");

            return {
                kind: "material",
                materialId: reference.pathId
            };
        }

        if (reference.type === "Sprite")
        {
            if (!this.spritesById.has(reference.pathId))
                throw new BindingResolutionError("An animated Sprite is missing from the runtime package.");

            return {
                kind: "sprite",
                spriteId: reference.pathId
            };
        }

        throw new BindingResolutionError(`Unsupported animated object-reference type "${reference.type}".`);
    }

    private requireRenderer(gameObjectId: string, typeId: number): RendererTarget {
        if (typeId === this.SKINNED_MESH_RENDERER_TYPE_ID)
        {
            const matches = this.skinnedRenderersByGameObjectId.get(gameObjectId) ?? [];
            if (matches.length !== 1)
                throw new BindingResolutionError("The SkinnedMeshRenderer target could not be resolved uniquely.");

            const renderer = matches[0];

            return {
                rendererId: renderer.id,
                rendererType: "SkinnedMeshRenderer",
                materialIds: renderer.materialIds,
                meshId: renderer.meshId
            };
        }

        if (typeId === this.SPRITE_RENDERER_TYPE_ID)
        {
            const matches = this.spriteRenderersByGameObjectId.get(gameObjectId) ?? [];
            if (matches.length !== 1)
                throw new BindingResolutionError("The SpriteRenderer target could not be resolved uniquely.");

            const renderer = matches[0];

            return {
                rendererId: renderer.id,
                rendererType: "SpriteRenderer",
                materialIds: renderer.materialIds,
                meshId: null
            };
        }

        if (typeId === this.MESH_RENDERER_TYPE_ID || typeId === this.PARTICLE_SYSTEM_RENDERER_TYPE_ID)
            throw new BindingResolutionError("This renderer type is not exported by runtime format.");

        throw new BindingResolutionError(`Unsupported renderer type ${typeId}.`);
    }

    private isStaleNumberedBlendShapeBinding(mesh: AnimatorRuntimeMesh, attribute: number): boolean {
        for (const shape of mesh.blendShapes)
        {
            const match = /^(.*?)(\d{3})$/.exec(shape.name);
            if (!match)
                continue;

            const prefix = match[1];

            for (let suffix = 0; suffix <= 999; suffix++)
            {
                const candidate = `${prefix}${suffix.toString().padStart(3, "0")}`;

                if (candidate === shape.name)
                    continue;

                if (UnityCrc32.generateCrc(candidate) === attribute)
                    return true;
            }
        }

        return false;
    }

    private buildPathIndex(animator: AnimatorRuntimeAnimator): Map<number, AnimatorRuntimeTransform[]> {
        const animatorTransform = this.transformsByGameObjectId.get(animator.gameObjectId);
        if (!animatorTransform)
            throw new Error(`Animator "${animator.id}" has no Transform.`);

        const animatorPath = animatorTransform.relativePath;
        const descendantPrefix = animatorPath ? `${animatorPath}/` : "";
        const result = new Map<number, AnimatorRuntimeTransform[]>();

        for (const transform of this.scene.transforms)
        {
            let localPath: string;

            if (transform.id === animatorTransform.id)
                localPath = "";
            else if (transform.relativePath.startsWith(descendantPrefix))
                localPath = transform.relativePath.slice(descendantPrefix.length);
            else
                continue;

            const hash = UnityCrc32.generateCrc(localPath);
            const existing = result.get(hash);

            if (existing)
                existing.push(transform);
            else
                result.set(hash, [transform]);
        }

        return result;
    }

    private requireTarget(targetsByHash: Map<number, AnimatorRuntimeTransform[]>, pathHash: number, clipName: string, bindingIndex: number): AnimatorRuntimeTransform {
        const matches = targetsByHash.get(pathHash >>> 0) ?? [];

        if (matches.length !== 1)
        {
            throw new BindingResolutionError(
                matches.length === 0
                    ? `AnimationClip "${clipName}" binding ${bindingIndex} targets an unknown path hash ${pathHash >>> 0}.`
                    : `AnimationClip "${clipName}" binding ${bindingIndex} has an ambiguous path hash ${pathHash >>> 0}.`
            );
        }

        return matches[0];
    }

    private indexTransformsByGameObject(): Map<string, AnimatorRuntimeTransform> {
        const result = new Map<string, AnimatorRuntimeTransform>();

        for (const transform of this.scene.transforms)
        {
            if (result.has(transform.gameObjectId))
                throw new Error(`GameObject "${transform.gameObjectId}" has multiple Transforms.`);

            result.set(transform.gameObjectId, transform);
        }

        return result;
    }

    private groupByGameObject<T extends Readonly<{ gameObjectId: string }>>(values: readonly T[]): Map<string, T[]> {
        const result = new Map<string, T[]>();

        for (const value of values)
        {
            const existing = result.get(value.gameObjectId);

            if (existing)
                existing.push(value);
            else
                result.set(value.gameObjectId, [value]);
        }

        return result;
    }
}
