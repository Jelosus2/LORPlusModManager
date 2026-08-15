import type { PreparedAnimatorBlendShape, PreparedAnimatorBlendShapeFrame, PreparedAnimatorMesh } from "./AnimatorPreparedGeometry";
import type { PreparedAnimatorSkinnedRenderer, PreparedAnimatorMeshRenderer } from "./AnimatorRendererModel";
import type { AnimatorSkinnedMeshRendererState, AnimatorSceneState } from "./AnimatorSceneState";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";

import { AnimatorMatrix4, type AnimatorMatrix4Array } from "./AnimatorMatrix4";
import { AnimatorRendererModel } from "./AnimatorRendererModel";

type BlendShapeContribution = Readonly<{
    frame: PreparedAnimatorBlendShapeFrame;
    coefficient: number;
}>;

export interface AnimatorProjectedMesh {
    readonly positions2d: Float32Array;
    visible: boolean;
}

export class AnimatorDeformedSkinnedMesh implements AnimatorProjectedMesh {
    private readonly WEIGHT_EPSILON = 0.000001;
    private readonly FRAME_EPSILON = 0.000001;
    private readonly mesh: PreparedAnimatorMesh;
    private readonly localPositions: Float32Array;
    private readonly boneMatrices: AnimatorMatrix4Array[];
    readonly worldPositions: Float32Array;
    readonly positions2d: Float32Array;
    visible = false;

    constructor(
        readonly renderer: PreparedAnimatorSkinnedRenderer,
        private readonly state: AnimatorSceneState,
        private readonly hierarchy: AnimatorTransformHierarchy
    ) {
        if (!renderer.mesh)
            throw new Error(`SkinnedMeshRenderer "${renderer.id}" has no Mesh to deform.`);

        this.mesh = renderer.mesh;
        this.localPositions = new Float32Array(this.mesh.positions.length);
        this.worldPositions = new Float32Array(this.mesh.vertexCount * 3);
        this.positions2d = new Float32Array(this.mesh.vertexCount * 2);
        this.boneMatrices = renderer.bindPoses.map(() => AnimatorMatrix4.createAnimatorMatrix4());

        for (const shape of this.mesh.blendShapes)
            this.validateBlendShapeFrames(shape);
    }

    update() {
        const rendererState = this.state.requireSkinnedMeshRenderer(this.renderer.id);

        this.visible = rendererState.enabled && this.hierarchy.isGameObjectActiveInHierarchy(this.renderer.gameObjectId);
        if (!this.visible)
            return;

        this.localPositions.set(this.mesh.positions);
        this.applyBlendShapes(rendererState);

        if (this.hasWeightedGeometry())
        {
            this.updateBoneMatrices();
            this.applySkinning();
        }
        else
        {
            this.applyRendererTransform();
        }

        this.updateProjectedPositions();
    }

    private applyBlendShapes(rendererState: AnimatorSkinnedMeshRendererState) {
        for (let shapeIndex = 0; shapeIndex < this.mesh.blendShapes.length; shapeIndex++)
        {
            const shape = this.mesh.blendShapes[shapeIndex];
            const weight = rendererState.blendShapeWeights[shapeIndex] ?? 0;

            if (!Number.isFinite(weight) || Math.abs(weight) <= this.FRAME_EPSILON)
                continue;

            for (const contribution of this.getFrameContributions(shape, weight))
                this.applyBlendShapeFrame(contribution.frame, contribution.coefficient);
        }
    }

    private getFrameContributions(shape: PreparedAnimatorBlendShape, weight: number): readonly BlendShapeContribution[] {
        const frames = shape.frames;
        if (frames.length === 0)
            return [];

        const firstFrame = frames[0];

        if (weight <= firstFrame.weight)
        {
            return [{
                frame: firstFrame,
                coefficient: weight / firstFrame.weight
            }];
        }

        for (let i = 1; i < frames.length; i++)
        {
            const upperFrame = frames[i];
            if (weight > upperFrame.weight)
                continue;

            const lowerFrame = frames[i - 1];
            const range = upperFrame.weight - lowerFrame.weight;
            const interpolation = (weight - lowerFrame.weight) / range;

            return [
                {
                    frame: lowerFrame,
                    coefficient: 1 - interpolation
                },
                {
                    frame: upperFrame,
                    coefficient: interpolation
                }
            ];
        }

        const lastFrame = frames[frames.length - 1];

        if (frames.length === 1)
        {
            return [{
                frame: lastFrame,
                coefficient: weight / lastFrame.weight
            }];
        }

        const previousFrame = frames[frames.length - 2];
        const range = lastFrame.weight - previousFrame.weight;
        const interpolation = (weight - previousFrame.weight) / range;

        return [
            {
                frame: previousFrame,
                coefficient: 1 - interpolation
            },
            {
                frame: lastFrame,
                coefficient: interpolation
            }
        ];
    }

    private applyBlendShapeFrame(frame: PreparedAnimatorBlendShapeFrame, coefficient: number) {
        if (Math.abs(coefficient) <= this.FRAME_EPSILON || !frame.indices || !frame.positions)
            return;

        for (let deltaIndex = 0; deltaIndex < frame.indices.length; deltaIndex++)
        {
            const vertexIndex = frame.indices[deltaIndex] as number;
            const vertexOffset = vertexIndex * 3;
            const deltaOffset = deltaIndex * 3;

            this.localPositions[vertexOffset] += frame.positions[deltaOffset] * coefficient;
            this.localPositions[vertexOffset + 1] += frame.positions[deltaOffset + 1] * coefficient;
            this.localPositions[vertexOffset + 2] += frame.positions[deltaOffset + 2] * coefficient;
        }
    }

    private updateBoneMatrices() {
        for (let boneIndex = 0; boneIndex < this.renderer.bindPoses.length; boneIndex++)
        {
            const boneTransformId = this.renderer.boneTransformIds[boneIndex];
            if (!boneTransformId)
                throw new Error(`SkinnedMeshRenderer "${this.renderer.id}" is missing bone ${boneIndex}.`);

            const boneWorldMatrix = this.hierarchy.requireWorldMatrix(boneTransformId);
            const bindPose = this.renderer.bindPoses[boneIndex];

            AnimatorMatrix4.multiplyAnimatorMatrix4(this.boneMatrices[boneIndex], boneWorldMatrix, bindPose);
        }
    }

    private applySkinning() {
        const boneIndices = this.mesh.boneIndices;
        const boneWeights = this.mesh.boneWeights;

        if (!boneIndices || !boneWeights)
            throw new Error(`Mesh "${this.mesh.name}" has incomplete skinning data.`);

        const rendererWorldMatrix = this.hierarchy.requireWorldMatrix(this.renderer.transformId);

        for (let vertexIndex = 0; vertexIndex < this.mesh.vertexCount; vertexIndex++)
        {
            const vertexOffset = vertexIndex * 3;
            const influenceOffset = vertexIndex * 4;

            const x = this.localPositions[vertexOffset];
            const y = this.localPositions[vertexOffset + 1];
            const z = this.localPositions[vertexOffset + 2];

            let outputX = 0;
            let outputY = 0;
            let outputZ = 0;
            let totalWeight = 0;

            for (let influence = 0; influence < 4; influence++)
            {
                const offset = influenceOffset + influence;
                const weight = boneWeights[offset];

                if (weight <= this.WEIGHT_EPSILON)
                    continue;

                const boneIndex = boneIndices[offset];
                const matrix = this.boneMatrices[boneIndex];

                if (!matrix)
                    throw new Error(`Mesh "${this.mesh.name}" references unavailable bone matrix ${boneIndex}.`);

                outputX += (
                    matrix[0] * x +
                    matrix[1] * y +
                    matrix[2] * z +
                    matrix[3]
                ) * weight;

                outputY += (
                    matrix[4] * x +
                    matrix[5] * y +
                    matrix[6] * z +
                    matrix[7]
                ) * weight;

                outputZ += (
                    matrix[8] * x +
                    matrix[9] * y +
                    matrix[10] * z +
                    matrix[11]
                ) * weight;

                totalWeight += weight;
            }

            if (totalWeight <= this.WEIGHT_EPSILON)
            {
                AnimatorMatrix4.writeTransformedAnimatorPoint3(
                    this.worldPositions,
                    vertexOffset,
                    rendererWorldMatrix,
                    x,
                    y,
                    z
                );
            }
            else
            {
                this.worldPositions[vertexOffset] = outputX;
                this.worldPositions[vertexOffset + 1] = outputY;
                this.worldPositions[vertexOffset + 2] = outputZ;
            }
        }
    }

    private applyRendererTransform() {
        const rendererWorldMatrix = this.hierarchy.requireWorldMatrix(this.renderer.transformId);

        for (let vertexIndex = 0; vertexIndex < this.mesh.vertexCount; vertexIndex++)
        {
            const offset = vertexIndex * 3;

            AnimatorMatrix4.writeTransformedAnimatorPoint3(
                this.worldPositions,
                offset,
                rendererWorldMatrix,
                this.localPositions[offset],
                this.localPositions[offset + 1],
                this.localPositions[offset + 2]
            );
        }
    }

    private updateProjectedPositions() {
        for (let vertexIndex = 0; vertexIndex < this.mesh.vertexCount; vertexIndex++)
        {
            const worldOffset = vertexIndex * 3;
            const projectedOffset = vertexIndex * 2;

            this.positions2d[projectedOffset] = this.worldPositions[worldOffset];
            this.positions2d[projectedOffset + 1] = this.worldPositions[worldOffset + 1];
        }
    }

    private hasWeightedGeometry(): boolean {
        const weights = this.mesh.boneWeights;

        if (!weights || this.renderer.bindPoses.length === 0)
            return false;

        return weights.some((weight) => weight > this.WEIGHT_EPSILON);
    }

    private validateBlendShapeFrames(shape: PreparedAnimatorBlendShape) {
        let previousWeight = 0;

        for (let frameIndex = 0; frameIndex < shape.frames.length; frameIndex++)
        {
            const frame = shape.frames[frameIndex];
            if (!Number.isFinite(frame.weight) || frame.weight <= previousWeight)
                throw new Error(`Blend shape "${shape.name}" has invalid or unordered frame weights.`);

            previousWeight = frame.weight;
        }
    }
}

export class AnimatorProjectedRigidMesh implements AnimatorProjectedMesh {
    private readonly mesh: PreparedAnimatorMesh;
    readonly positions2d: Float32Array;
    visible = false;

    constructor(
        readonly renderer: PreparedAnimatorMeshRenderer,
        private readonly state: AnimatorSceneState,
        private readonly hierarchy: AnimatorTransformHierarchy
    ) {
        if (!renderer.mesh)
            throw new Error(`MeshRenderer "${renderer.id}" has no Mesh to project.`);

        this.mesh = renderer.mesh;
        this.positions2d = new Float32Array(this.mesh.vertexCount * 2);
    }

    update() {
        const rendererState = this.state.requireMeshRenderer(this.renderer.id);

        this.visible = rendererState.enabled && this.hierarchy.isGameObjectActiveInHierarchy(this.renderer.gameObjectId);
        if (!this.visible)
            return;

        const worldMatrix = this.hierarchy.requireWorldMatrix(this.renderer.transformId);

        for (let vertexIndex = 0; vertexIndex < this.mesh.vertexCount; vertexIndex++)
        {
            const sourceOffset = vertexIndex * 3;
            const projectedOffset = vertexIndex * 2;
            const x = this.mesh.positions[sourceOffset];
            const y = this.mesh.positions[sourceOffset + 1];
            const z = this.mesh.positions[sourceOffset + 2];

            this.positions2d[projectedOffset] = worldMatrix[0] * x + worldMatrix[1] * y + worldMatrix[2] * z + worldMatrix[3];
            this.positions2d[projectedOffset + 1] = worldMatrix[4] * x + worldMatrix[5] * y + worldMatrix[6] * z + worldMatrix[7];
        }
    }
}

export class AnimatorMeshDeformer {
    readonly rigidMeshes = new Map<string, AnimatorProjectedRigidMesh>();
    readonly meshes = new Map<string, AnimatorDeformedSkinnedMesh>();

    constructor(renderers: AnimatorRendererModel, state: AnimatorSceneState, hierarchy: AnimatorTransformHierarchy) {
        for (const renderer of renderers.meshRenderers)
        {
            if (!renderer.mesh)
                continue;

            if (this.rigidMeshes.has(renderer.id))
                throw new Error(`MeshRenderer "${renderer.id}" has multiple mesh projectors.`);

            this.rigidMeshes.set(renderer.id, new AnimatorProjectedRigidMesh(renderer, state, hierarchy));
        }

        for (const renderer of renderers.skinnedMeshRenderers)
        {
            if (!renderer.mesh)
                continue;

            if (this.meshes.has(renderer.id))
                throw new Error(`SkinnedMeshRenderer "${renderer.id}" has multiple deformers.`);

            this.meshes.set(renderer.id, new AnimatorDeformedSkinnedMesh(renderer, state, hierarchy));
        }
    }

    update() {
        for (const mesh of this.rigidMeshes.values())
            mesh.update();

        for (const mesh of this.meshes.values())
            mesh.update();
    }

    requireRigid(rendererId: string): AnimatorProjectedRigidMesh {
        const mesh = this.rigidMeshes.get(rendererId);
        if (!mesh)
            throw new Error(`MeshRenderer "${rendererId}" has no mesh projector.`);

        return mesh;
    }

    require(rendererId: string): AnimatorDeformedSkinnedMesh {
        const mesh = this.meshes.get(rendererId);
        if (!mesh)
            throw new Error(`SkinnedMeshRenderer "${rendererId}" has no mesh deformer.`);

        return mesh;
    }
}
