import type {
    AnimatorRuntimeBlendShape,
    AnimatorRuntimeBlendShapeFrame,
    AnimatorRuntimeMesh,
    AnimatorRuntimeScene,
    AnimatorRuntimeSprite,
    AnimatorRuntimeSubmesh
} from "./AnimatorBindingResolver";
import type { AnimatorFloat32GeometryDefinition, AnimatorUint16GeometryDefinition, AnimatorUint32GeometryDefinition } from "./AnimatorGeometryReader";

import { AnimatorGeometryReader } from "./AnimatorGeometryReader";

export type PreparedAnimatorBlendShapeFrame = Readonly<{
    weight: number;
    indices: Uint32Array | null;
    positions: Float32Array | null;
    normals: Float32Array | null;
    tangents: Float32Array | null;
}>;

export type PreparedAnimatorBlendShape = Readonly<{
    name: string;
    nameHash: number;
    frames: readonly PreparedAnimatorBlendShapeFrame[];
}>;

export type PreparedAnimatorSubmesh = Readonly<{
    materialSlot: number;
    topology: "triangle-list";
    indices: Uint32Array;
}>;

export type PreparedAnimatorMesh = Readonly<{
    id: string;
    name: string;
    vertexCount: number;
    positions: Float32Array;
    normals: Float32Array | null;
    uv0: Float32Array | null;
    boneIndices: Uint16Array | null;
    boneWeights: Float32Array | null;
    bindPoses: Float32Array | null;
    submeshes: readonly PreparedAnimatorSubmesh[];
    blendShapes: readonly PreparedAnimatorBlendShape[];
}>;

export type PreparedAnimatorSpriteMesh = Readonly<{
    positions: Float32Array;
    uv0: Float32Array | null;
    indices: Uint32Array;
}>;

export type PreparedAnimatorSprite = Readonly<{
    id: string;
    name: string;
    mesh: PreparedAnimatorSpriteMesh | null;
}>;

export class AnimatorPreparedGeometry {
    private readonly EPSILON = 0.000001;
    readonly meshes = new Map<string, PreparedAnimatorMesh>();
    readonly sprites = new Map<string, PreparedAnimatorSprite>();

    constructor(scene: AnimatorRuntimeScene, private readonly geometry: AnimatorGeometryReader) {
        for (const mesh of scene.meshes)
        {
            if (this.meshes.has(mesh.id))
                throw new Error(`Mesh "${mesh.id}" is duplicated.`);

            this.meshes.set(mesh.id, this.prepareMesh(mesh));
        }

        for (const sprite of scene.sprites)
        {
            if (this.sprites.has(sprite.id))
                throw new Error(`Sprite "${sprite.id}" is duplicated.`);

            this.sprites.set(sprite.id, this.prepareSprite(sprite));
        }
    }

    requireMesh(id: string): PreparedAnimatorMesh {
        const mesh = this.meshes.get(id);
        if (!mesh)
            throw new Error(`Mesh "${id}" is missing from prepared geometry.`);

        return mesh;
    }

    requireSprite(id: string): PreparedAnimatorSprite {
        const sprite = this.sprites.get(id);
        if (!sprite)
            throw new Error(`Sprite "${id}" is missing from prepared geometry.`);

        return sprite;
    }

    private prepareMesh(mesh: AnimatorRuntimeMesh): PreparedAnimatorMesh {
        if (!Number.isSafeInteger(mesh.vertexCount) || mesh.vertexCount <= 0)
            throw new Error(`Mesh "${mesh.name}" has an invalid vertex count.`);

        const positions = this.readFloat32(mesh.positions, mesh.vertexCount, 3, `Mesh "${mesh.name}" positions`);
        const normals = mesh.normals
            ? this.readFloat32(mesh.normals, mesh.vertexCount, 3, `Mesh "${mesh.name}" normals`)
            : null;

        const uv0 = mesh.uv0
            ? this.readFloat32(mesh.uv0, mesh.vertexCount, 2, `Mesh "${mesh.name}" UVs`)
            : null;

        const boneIndices = mesh.boneIndices
            ? this.readUint16(mesh.boneIndices, mesh.vertexCount, 4, `Mesh "${mesh.name}" bone indices`)
            : null;

        const boneWeights = mesh.boneWeights
            ? this.readFloat32(mesh.boneWeights, mesh.vertexCount, 4, `Mesh "${mesh.name}" bone weights`)
            : null;

        const bindPoses = mesh.bindPoses
            ? this.readFloat32(mesh.bindPoses, mesh.bindPoses.count, 16, `Mesh "${mesh.name}" bind poses`)
            : null;

        const indices = mesh.indices
            ? this.readUint32(mesh.indices, mesh.indices.count, 1, `Mesh "${mesh.name}" indices`)
            : null;

        if ((boneIndices === null) !== (boneWeights === null))
            throw new Error(`Mesh "${mesh.name}" has incomplete skinning data.`);

        const hasWeightedVertices = boneWeights?.some((weight) => weight > this.EPSILON) ?? false;
        if (hasWeightedVertices && (bindPoses === null || bindPoses.length === 0 || bindPoses.length % 16 !== 0))
            throw new Error(`Mesh "${mesh.name}" has no valid bind poses.`);

        this.validateBoneWeights(mesh, boneIndices, boneWeights);

        return {
            id: mesh.id,
            name: mesh.name,
            vertexCount: mesh.vertexCount,
            positions,
            normals,
            uv0,
            boneIndices,
            boneWeights,
            bindPoses,
            submeshes: this.prepareSubmeshes(mesh, indices),
            blendShapes: mesh.blendShapes.map((shape) => this.prepareBlendShape(mesh, shape))
        };
    }

    private prepareSubmeshes(mesh: AnimatorRuntimeMesh, sourceIndices: Uint32Array | null): readonly PreparedAnimatorSubmesh[] {
        if (mesh.submeshes.length === 0)
            return [];

        if (!sourceIndices)
            throw new Error(`Mesh "${mesh.name}" has submeshes but no index buffer.`);

        return mesh.submeshes.map((submesh) => this.prepareSubmesh(mesh, submesh, sourceIndices));
    }

    private prepareSubmesh(mesh: AnimatorRuntimeMesh, submesh: AnimatorRuntimeSubmesh, sourceIndices: Uint32Array): PreparedAnimatorSubmesh {
        if (
            !Number.isSafeInteger(submesh.materialSlot) ||
            !Number.isSafeInteger(submesh.indexStart) ||
            !Number.isSafeInteger(submesh.indexCount) ||
            !Number.isSafeInteger(submesh.baseVertex) ||
            submesh.materialSlot < 0 ||
            submesh.indexStart < 0 ||
            submesh.indexCount < 0 ||
            submesh.baseVertex < 0 ||
            submesh.indexStart + submesh.indexCount > sourceIndices.length
        )
        {
            throw new Error(`Mesh "${mesh.name}" has an invalid submesh.`);
        }

        if (submesh.topology !== 0)
            throw new Error(`Mesh "${mesh.name}" uses unsupported topology ${submesh.topology}.`);
        if (submesh.indexCount % 3 !== 0)
            throw new Error(`Mesh "${mesh.name}" has a non-triangular submesh.`);

        const result = new Uint32Array(submesh.indexCount);

        for (let i = 0; i < submesh.indexCount; i++)
        {
            const sourceIndex = sourceIndices[submesh.indexStart + i];
            const vertexIndex = sourceIndex + submesh.baseVertex;

            if (vertexIndex >= mesh.vertexCount)
                throw new Error(`Mesh "${mesh.name}" has an out-of-range triangle index.`);

            result[i] = vertexIndex;
        }

        return {
            materialSlot: submesh.materialSlot,
            topology: "triangle-list",
            indices: result
        };
    }

    private prepareBlendShape(mesh: AnimatorRuntimeMesh, shape: AnimatorRuntimeBlendShape): PreparedAnimatorBlendShape {
        if (!shape.name || !Number.isInteger(shape.nameHash))
            throw new Error(`Mesh "${mesh.name}" has an invalid blend shape.`);

        return {
            name: shape.name,
            nameHash: shape.nameHash,
            frames: shape.frames.map((frame) => this.prepareBlendShapeFrame(mesh, shape, frame))
        };
    }

    private prepareBlendShapeFrame(mesh: AnimatorRuntimeMesh, shape: AnimatorRuntimeBlendShape, frame: AnimatorRuntimeBlendShapeFrame): PreparedAnimatorBlendShapeFrame {
        if (!Number.isFinite(frame.weight))
            throw new Error(`Blend shape "${shape.name}" has an invalid frame weight.`);

        if (frame.indices === null && frame.positions === null)
        {
            if (frame.normals !== null || frame.tangents !== null)
                throw new Error(`Blend shape "${shape.name}" has incomplete frame geometry.`);

            return {
                weight: frame.weight,
                indices: null,
                positions: null,
                normals: null,
                tangents: null
            };
        }

        if (frame.indices === null || frame.positions === null)
            throw new Error(`Blend shape "${shape.name}" has incomplete frame geometry.`);

        const indices = this.readUint32(frame.indices, frame.indices.count, 1, `Blend shape "${shape.name}" indices`);
        const positions = this.readFloat32(frame.positions, indices.length, 3, `Blend shape "${shape.name}" positions`);

        const normals = frame.normals
            ? this.readFloat32(frame.normals, indices.length, 3, `Blend shape "${shape.name}" normals`)
            : null;

        const tangents = frame.tangents
            ? this.readFloat32(frame.tangents, indices.length, 3, `Blend shape "${shape.name}" tangents`)
            : null;

        for (const vertexIndex of indices)
        {
            if (vertexIndex >= mesh.vertexCount)
                throw new Error(`Blend shape "${shape.name}" references an invalid vertex.`);
        }

        return {
            weight: frame.weight,
            indices,
            positions,
            normals,
            tangents
        };
    }

    private prepareSprite(sprite: AnimatorRuntimeSprite): PreparedAnimatorSprite {
        const mesh = sprite.mesh;

        if (!mesh)
        {
            return {
                id: sprite.id,
                name: sprite.name,
                mesh: null
            };
        }

        const positions = this.readFloat32(mesh.positions, mesh.positions.count, 2, `Sprite "${sprite.name}" positions`);

        const uv0 = mesh.uv0
            ? this.readFloat32(mesh.uv0, positions.length / 2, 2, `Sprite "${sprite.name}" UVs`)
            : null;

        const indices = this.readUint32(mesh.indices, mesh.indices.count, 1, `Sprite "${sprite.name}" indices`);
        const vertexCount = positions.length / 2;

        if (indices.length % 3 !== 0)
            throw new Error(`Sprite "${sprite.name}" has a non-triangular mesh.`);

        for (const vertexIndex of indices)
        {
            if (vertexIndex >= vertexCount)
                throw new Error(`Sprite "${sprite.name}" references an invalid vertex.`);
        }

        return {
            id: sprite.id,
            name: sprite.name,
            mesh: {
                positions,
                uv0,
                indices
            }
        };
    }

    private validateBoneWeights(mesh: AnimatorRuntimeMesh, boneIndices: Uint16Array | null, boneWeights: Float32Array | null) {
        if (!boneIndices || !boneWeights)
            return;

        if (boneIndices.length !== boneWeights.length)
            throw new Error( `Mesh "${mesh.name}" has mismatched skinning arrays.`);

        for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex++)
        {
            const offset = vertexIndex * 4;
            let totalWeight = 0;

            for (let influence = 0; influence < 4; influence++)
            {
                const weight = boneWeights[offset + influence];

                if (!Number.isFinite(weight) || weight < 0)
                    throw new Error(`Mesh "${mesh.name}" has an invalid bone weight.`);

                totalWeight += weight;
            }

            if (totalWeight > this.EPSILON && Math.abs(totalWeight - 1) > 0.01)
                throw new Error(`Mesh "${mesh.name}" has non-normalized bone weights.`);
        }
    }

    private readFloat32(definition: AnimatorFloat32GeometryDefinition, expectedCount: number, expectedComponents: number, context: string): Float32Array {
        this.requireShape(definition, expectedCount, expectedComponents, context);

        const values = this.geometry.readFloat32(definition);
        this.requireFinite(values, context);

        return values;
    }

    private readUint16(definition: AnimatorUint16GeometryDefinition, expectedCount: number, expectedComponents: number, context: string): Uint16Array {
        this.requireShape(definition, expectedCount, expectedComponents, context);

        return this.geometry.readUint16(definition);
    }

    private readUint32(definition: AnimatorUint32GeometryDefinition, expectedCount: number, expectedComponents: number, context: string): Uint32Array {
        this.requireShape(definition, expectedCount, expectedComponents, context);

        return this.geometry.readUint32(definition);
    }

    private requireShape(
        definition: Readonly<{ count: number; components: number; }>,
        expectedCount: number,
        expectedComponents: number,
        context: string
    ) {
        if (definition.count !== expectedCount || definition.components !== expectedComponents)
            throw new Error(`${context} has an invalid shape.`);
    }

    private requireFinite(values: Float32Array, context: string) {
        for (const value of values)
        {
            if (!Number.isFinite(value))
                throw new Error(`${context} contains a non-finite value.`);
        }
    }
}
