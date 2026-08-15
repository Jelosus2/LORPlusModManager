import type { AnimatorRuntimeScene, AnimatorRuntimeTransform } from "./AnimatorBindingResolver";
import type { AnimatorSceneState } from "./AnimatorSceneState";

import { AnimatorMatrix4, type AnimatorMatrix4Array } from "./AnimatorMatrix4";
import { AnimatorQuaternion } from "./AnimatorQuaternion";

export class AnimatorTransformHierarchy {
    private readonly transformsById = new Map<string, AnimatorRuntimeTransform>();
    private readonly transformIdsByGameObjectId = new Map<string, string>();
    private readonly traversalOrder: readonly string[];
    private readonly worldMatrices = new Map<string, AnimatorMatrix4Array>();
    private readonly activeInHierarchy = new Map<string, boolean>();
    private readonly localMatrix = AnimatorMatrix4.createAnimatorMatrix4();
    private readonly worldRotations = new Map<string, number[]>();
    private readonly localScalingParticleMatrices = new Map<string, AnimatorMatrix4Array>();
    private readonly particleWorldPosition = [0, 0, 0];
    readonly rootTransformId: string;

    constructor(scene: AnimatorRuntimeScene) {
        const gameObjectIds = this.indexGameObjects(scene);

        for (const transform of scene.transforms)
        {
            if (this.transformsById.has(transform.id))
                throw new Error(`Transform "${transform.id}" is duplicated.`);
            if (this.transformIdsByGameObjectId.has(transform.gameObjectId))
                throw new Error(`GameObject "${transform.gameObjectId}" has multiple Transforms.`);
            if (!gameObjectIds.has(transform.gameObjectId))
                throw new Error(`Transform "${transform.id}" references an unknown GameObject.`);

            this.transformsById.set(transform.id, transform);
            this.transformIdsByGameObjectId.set(transform.gameObjectId, transform.id);
            this.worldMatrices.set(transform.id, AnimatorMatrix4.createAnimatorMatrix4());
            this.worldRotations.set(transform.id, AnimatorQuaternion.createIdentity());
            this.activeInHierarchy.set(transform.id, false);
            this.localScalingParticleMatrices.set(transform.id, AnimatorMatrix4.createAnimatorMatrix4());
        }

        const hierarchy = this.validateHierarchy();

        this.rootTransformId = hierarchy.rootTransformId;
        this.traversalOrder = hierarchy.traversalOrder;
    }

    update(state: AnimatorSceneState) {
        for (const transformId of this.traversalOrder)
        {
            const transform = this.requireTransform(transformId);
            const transformState = state.requireTransform(transformId);
            const worldMatrix = this.requireWorldMatrix(transformId);

            AnimatorMatrix4.setAnimatorMatrix4FromTrs(
                this.localMatrix,
                transformState.localPosition,
                transformState.localRotation,
                transformState.localScale
            );

            const worldRotation = this.requireWorldRotation(transformId);

            if (transform.parentId)
            {
                const parentWorld = this.requireWorldMatrix(transform.parentId);

                AnimatorMatrix4.multiplyAnimatorMatrix4(worldMatrix, parentWorld, this.localMatrix);
                AnimatorQuaternion.multiplyInto(worldRotation, this.requireWorldRotation(transform.parentId), transformState.localRotation);
            }
            else
            {
                worldMatrix.set(this.localMatrix);
                AnimatorQuaternion.normalizeInto(worldRotation, transformState.localRotation);
            }

            const localScalingParticleMatrix = this.requireParticleWorldMatrix(transformId, 1);

            this.particleWorldPosition[0] = worldMatrix[3];
            this.particleWorldPosition[1] = worldMatrix[7];
            this.particleWorldPosition[2] = worldMatrix[11];

            AnimatorMatrix4.setAnimatorMatrix4FromTrs(localScalingParticleMatrix, this.particleWorldPosition, worldRotation, transformState.localScale);

            const ownActive = state.requireGameObject(transform.gameObjectId).active;
            const parentActive = transform.parentId
                ? this.isActiveInHierarchy(transform.parentId)
                : true;

            this.activeInHierarchy.set(transformId, parentActive && ownActive);
        }
    }

    requireWorldMatrix(transformId: string): AnimatorMatrix4Array {
        const matrix = this.worldMatrices.get(transformId);
        if (!matrix)
            throw new Error(`Transform "${transformId}" has no evaluated world matrix.`);

        return matrix;
    }

    requireWorldRotation(transformId: string): number[] {
        const rotation = this.worldRotations.get(transformId);
        if (!rotation)
            throw new Error(`Transform "${transformId}" has no evaluated world rotation.`);

        return rotation;
    }

    requireWorldMatrixForGameObject(gameObjectId: string): AnimatorMatrix4Array {
        return this.requireWorldMatrix(this.requireTransformIdForGameObject(gameObjectId));
    }

    requireTransformIdForGameObject(gameObjectId: string): string {
        const transformId = this.transformIdsByGameObjectId.get(gameObjectId);
        if (!transformId)
            throw new Error(`GameObject "${gameObjectId}" has no Transform.`);

        return transformId;
    }

    requireParticleWorldMatrix(transformId: string, scalingMode: 0 | 1): AnimatorMatrix4Array {
        if (scalingMode === 0)
            return this.requireWorldMatrix(transformId);

        const matrix = this.localScalingParticleMatrices.get(transformId);
        if (!matrix)
            throw new Error(`Transform "${transformId}" has no evaluated local-scaling particle matrix.`);

        return matrix;
    }

    isActiveInHierarchy(transformId: string): boolean {
        const active = this.activeInHierarchy.get(transformId);
        if (active === undefined)
            throw new Error(`Transform "${transformId}" has no active-state evaluation.`);

        return active;
    }

    isGameObjectActiveInHierarchy(gameObjectId: string): boolean {
        return this.isActiveInHierarchy(this.requireTransformIdForGameObject(gameObjectId));
    }

    getOrderedTransformIds(): readonly string[] {
        return this.traversalOrder;
    }

    private validateHierarchy(): { rootTransformId: string; traversalOrder: readonly string[]; } {
        if (this.transformsById.size === 0)
            throw new Error("The Animator scene has no Transform hierarchy.");

        const roots: string[] = [];
        const childClaimCounts = new Map<string, number>();

        for (const transform of this.transformsById.values())
        {
            if (transform.parentId === null)
            {
                roots.push(transform.id);
            }
            else
            {
                if (transform.parentId === transform.id || !this.transformsById.has(transform.parentId))
                    throw new Error(`Transform "${transform.id}" has an invalid parent.`);
            }

            const uniqueChildren = new Set<string>();

            for (const childId of transform.children)
            {
                if (uniqueChildren.has(childId))
                    throw new Error(`Transform "${transform.id}" contains a duplicate child.`);

                uniqueChildren.add(childId);

                const child = this.transformsById.get(childId);

                if (!child)
                    throw new Error(`Transform "${transform.id}" references an unknown child.`);
                if (child.parentId !== transform.id)
                    throw new Error(`Transform "${child.id}" has inconsistent parent metadata.`);

                childClaimCounts.set(childId, (childClaimCounts.get(childId) ?? 0) + 1);
            }
        }

        if (roots.length !== 1)
            throw new Error(`The Animator scene must have exactly one root Transform; found ${roots.length}.`);

        const rootTransformId = roots[0];

        for (const transform of this.transformsById.values())
        {
            const claimCount = childClaimCounts.get(transform.id) ?? 0;

            if (transform.id === rootTransformId)
            {
                if (claimCount !== 0)
                    throw new Error("The root Animator Transform is also claimed as a child.");
            }
            else if (claimCount !== 1)
            {
                throw new Error(`Transform "${transform.id}" is not claimed exactly once by its parent.`);
            }
        }

        const traversalOrder: string[] = [];
        const visited = new Set<string>();
        const stack = [rootTransformId];

        while (stack.length > 0)
        {
            const transformId = stack.pop()!;
            if (visited.has(transformId))
                throw new Error("The Animator Transform hierarchy contains a cycle.");

            visited.add(transformId);
            traversalOrder.push(transformId);

            const transform = this.requireTransform(transformId);

            for (let i = transform.children.length - 1; i >= 0; i--)
                stack.push(transform.children[i]);
        }

        if (visited.size !== this.transformsById.size)
            throw new Error("The Animator Transform hierarchy is disconnected or cyclic.");

        return {
            rootTransformId,
            traversalOrder
        };
    }

    private requireTransform(transformId: string): AnimatorRuntimeTransform {
        const transform = this.transformsById.get(transformId);
        if (!transform)
            throw new Error(`Transform "${transformId}" does not exist.`);

        return transform;
    }

    private indexGameObjects(scene: AnimatorRuntimeScene): Set<string> {
        const result = new Set<string>();

        for (const gameObject of scene.gameObjects)
        {
            if (result.has(gameObject.id))
                throw new Error(`GameObject "${gameObject.id}" is duplicated.`);

            result.add(gameObject.id);
        }

        return result;
    }
}
