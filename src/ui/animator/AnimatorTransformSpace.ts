import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import type { AnimatorRuntimeTransform } from "./AnimatorBindingResolver";
import type { AnimatorSceneState } from "./AnimatorSceneState";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";
import { AnimatorQuaternion } from "./AnimatorQuaternion";

export class AnimatorTransformSpace {
    private static readonly EPSILON = 0.000001;

    static getWorldPosition(hierarchy: AnimatorTransformHierarchy, transformId: string): number[] {
        const matrix = hierarchy.requireWorldMatrix(transformId);
        return [matrix[3], matrix[7], matrix[11]];
    }

    static setWorldPosition(
        transform: AnimatorRuntimeTransform,
        state: AnimatorSceneState,
        hierarchy: AnimatorTransformHierarchy,
        worldPosition: readonly number[]
    ) {
        AnimatorRuntimeUtils.requireFiniteVector(worldPosition, 3, "Transform world position");

        let localPosition = [...worldPosition];

        if (transform.parentId)
        {
            const parent = hierarchy.requireWorldMatrix(transform.parentId);
            const x = worldPosition[0] - parent[3];
            const y = worldPosition[1] - parent[7];
            const z = worldPosition[2] - parent[11];

            const determinant =
                parent[0] * (parent[5] * parent[10] - parent[6] * parent[9]) -
                parent[1] * (parent[4] * parent[10] - parent[6] * parent[8]) +
                parent[2] * (parent[4] * parent[9] - parent[5] * parent[8]);

            if (Math.abs(determinant) <= AnimatorTransformSpace.EPSILON)
                throw new Error(`Transform "${transform.id}" has a singular parent matrix.`);

            localPosition = [
                (
                    (parent[5] * parent[10] - parent[6] * parent[9]) * x +
                    (parent[2] * parent[9] - parent[1] * parent[10]) * y +
                    (parent[1] * parent[6] - parent[2] * parent[5]) * z
                ) / determinant,
                (
                    (parent[6] * parent[8] - parent[4] * parent[10]) * x +
                    (parent[0] * parent[10] - parent[2] * parent[8]) * y +
                    (parent[2] * parent[4] - parent[0] * parent[6]) * z
                ) / determinant,
                (
                    (parent[4] * parent[9] - parent[5] * parent[8]) * x +
                    (parent[1] * parent[8] - parent[0] * parent[9]) * y +
                    (parent[0] * parent[5] - parent[1] * parent[4]) * z
                ) / determinant
            ];
        }

        const destination = state.requireTransform(transform.id).localPosition;

        AnimatorRuntimeUtils.copyFiniteVector(destination, localPosition, 3, "Transform local position");
    }

    static setWorldRotation(
        transform: AnimatorRuntimeTransform,
        state: AnimatorSceneState,
        hierarchy: AnimatorTransformHierarchy,
        worldRotation: readonly number[]
    ) {
        let localRotation = AnimatorQuaternion.normalized(worldRotation);

        if (transform.parentId)
        {
            const inverseParent = AnimatorQuaternion.inverted(hierarchy.requireWorldRotation(transform.parentId));
            localRotation = AnimatorQuaternion.multiplied(inverseParent, localRotation);
        }

        AnimatorRuntimeUtils.copyFiniteVector(state.requireTransform(transform.id).localRotation, localRotation, 4, "Transform local rotation");
    }
}
