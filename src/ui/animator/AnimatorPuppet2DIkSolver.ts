import type { AnimatorRuntimePuppet2DIkHandle, AnimatorRuntimeScene, AnimatorRuntimeTransform } from "./AnimatorBindingResolver";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import type { AnimatorSceneState } from "./AnimatorSceneState";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";
import { AnimatorQuaternion } from "./AnimatorQuaternion";

export class AnimatorPuppet2DIkSolver {
    private readonly EPSILON = 0.000001;
    private readonly FORWARD: readonly number[] = [0, 0, 1];
    private readonly transformsById = new Map<string, AnimatorRuntimeTransform>();
    private readonly handles: readonly AnimatorRuntimePuppet2DIkHandle[];

    constructor(
        scene: AnimatorRuntimeScene,
        private readonly state: AnimatorSceneState,
        private readonly hierarchy: AnimatorTransformHierarchy
    ) {
        for (const transform of scene.transforms)
            this.transformsById.set(transform.id, transform);

        this.validateHandles(scene.puppet2dIkHandles);
        this.handles = scene.puppet2dIkHandles;
    }

    solve(): readonly string[] {
        const diagnostics: string[] = [];

        for (const handle of this.handles)
        {
            if (!handle.enabled || !this.hierarchy.isActiveInHierarchy(handle.controlTransformId))
                continue;

            const diagnostic = this.solveHandle(handle);
            if (diagnostic)
                diagnostics.push(diagnostic);
        }

        return diagnostics;
    }

    private solveHandle(handle: AnimatorRuntimePuppet2DIkHandle): string | null {
        const topState = this.state.requireTransform(handle.topJointTransformId);

        if (handle.squashAndStretch)
        {
            const destination = topState.localScale;
            AnimatorRuntimeUtils.copyFiniteVector(destination, handle.scaleStart[0], destination.length, "Puppet2D IK vector");
            this.hierarchy.update(this.state);
        }

        let topPosition = this.getWorldPosition(handle.topJointTransformId);
        let middlePosition = this.getWorldPosition(handle.middleJointTransformId);
        let bottomPosition = this.getWorldPosition(handle.bottomJointTransformId);
        const controlPosition = this.getWorldPosition(handle.controlTransformId);

        const upperLength = this.distance(topPosition, middlePosition);
        const lowerLength = this.distance(middlePosition, bottomPosition);
        const totalLength = upperLength + lowerLength;
        let targetDistance = this.distance(topPosition, controlPosition);

        if (upperLength <= this.EPSILON || lowerLength <= this.EPSILON || totalLength <= this.EPSILON)
            return `Puppet2D IK handle "${handle.componentId}" has a zero-length joint chain.`;
        if (targetDistance <= this.EPSILON)
            return `Puppet2D IK handle "${handle.componentId}" overlaps its top joint.`;

        const largerMiddleJoint = lowerLength > upperLength;

        if (handle.squashAndStretch && targetDistance > totalLength)
        {
            const initialScale = handle.scaleStart[0];

            topState.localScale[0] = initialScale[0];
            topState.localScale[1] = targetDistance / totalLength * initialScale[1];
            topState.localScale[2] = initialScale[2];

            this.hierarchy.update(this.state);

            topPosition = this.getWorldPosition(handle.topJointTransformId);
            middlePosition = this.getWorldPosition(handle.middleJointTransformId);
            bottomPosition = this.getWorldPosition(handle.bottomJointTransformId);
            targetDistance = this.distance(topPosition, controlPosition);
        }

        const clampedDistance = Math.min(targetDistance, totalLength - 0.0001);
        const cosine = (upperLength * upperLength - lowerLength * lowerLength + clampedDistance * clampedDistance) / (2 * clampedDistance * upperLength);

        const angle = Math.acos(cosine) * 180 / Math.PI;
        const handleState = this.state.requirePuppet2DIkHandle(handle.componentId);
        const direction = handleState.flip ? 1 : -1;
        const topToControl = this.subtract(controlPosition, topPosition);
        const topLookRotation = AnimatorQuaternion.lookRotation(topToControl, handle.aimDirection);

        let topWorldRotation: number[];

        if (Number.isFinite(angle))
        {
            const alignedRotation = AnimatorQuaternion.multiplied(topLookRotation, AnimatorQuaternion.angleAxis(90, handle.upDirection));
            topWorldRotation = AnimatorQuaternion.multiplied(alignedRotation, AnimatorQuaternion.angleAxis(angle * direction, this.FORWARD));
        }
        else
        {
            topWorldRotation = AnimatorQuaternion.multiplied(topLookRotation, AnimatorQuaternion.angleAxis(largerMiddleJoint ? -90 : 90, handle.upDirection));
        }

        const mirroredPlanarJointSpace = this.usesMirroredPlanarJointSpace(handle);

        this.setWorldRotation(handle.topJointTransformId, topWorldRotation, mirroredPlanarJointSpace);
        this.hierarchy.update(this.state);

        middlePosition = this.getWorldPosition(handle.middleJointTransformId);
        const middleToControl = this.subtract(controlPosition, middlePosition);

        if (Math.hypot(...middleToControl) <= this.EPSILON)
            return `Puppet2D IK handle "${handle.componentId}" overlaps its middle joint.`;

        const middleWorldRotation = AnimatorQuaternion.multiplied(
            AnimatorQuaternion.lookRotation(middleToControl, handle.aimDirection),
            AnimatorQuaternion.angleAxis(90, handle.upDirection)
        );

        this.setWorldRotation(handle.middleJointTransformId, middleWorldRotation, mirroredPlanarJointSpace);
        this.hierarchy.update(this.state);

        const bottomWorldRotation = AnimatorQuaternion.multiplied(this.hierarchy.requireWorldRotation(handle.controlTransformId), handle.offsetRotation);

        this.setWorldRotation(handle.bottomJointTransformId, bottomWorldRotation, mirroredPlanarJointSpace);

        if (handle.scaleBottomJoint)
        {
            const controlScale = this.state.requireTransform(handle.controlTransformId).localScale;
            const bottomScale = this.state.requireTransform(handle.bottomJointTransformId).localScale;

            bottomScale[0] = controlScale[0] * handle.offsetScale[0];
            bottomScale[1] = controlScale[1] * handle.offsetScale[1];
            bottomScale[2] = controlScale[2] * handle.offsetScale[2];
        }

        this.hierarchy.update(this.state);
        return null;
    }

    private validateHandles(handles: readonly AnimatorRuntimePuppet2DIkHandle[]) {
        const componentIds = new Set<string>();

        for (const handle of handles)
        {
            if (componentIds.has(handle.componentId))
                throw new Error(`Puppet2D IK handle "${handle.componentId}" is duplicated.`);

            componentIds.add(handle.componentId);

            this.requireTransform(handle.controlTransformId);
            this.requireTransform(handle.poleTransformId);
            this.requireTransform(handle.topJointTransformId);
            this.requireTransform(handle.middleJointTransformId);
            this.requireTransform(handle.bottomJointTransformId);

            const jointIds = new Set([
                handle.topJointTransformId,
                handle.middleJointTransformId,
                handle.bottomJointTransformId
            ]);

            if (jointIds.size !== 3)
                throw new Error(`Puppet2D IK handle "${handle.componentId}" has duplicate joints.`);

            AnimatorRuntimeUtils.requireFiniteVector(handle.aimDirection, 3, `Puppet2D IK handle "${handle.componentId}" aim direction`);
            AnimatorRuntimeUtils.requireFiniteVector(handle.upDirection, 3, `Puppet2D IK handle "${handle.componentId}" up direction`);
            this.requireNonZeroVector(handle.aimDirection, `Puppet2D IK handle "${handle.componentId}" aim direction`);
            this.requireNonZeroVector(handle.upDirection, `Puppet2D IK handle "${handle.componentId}" up direction`);

            if (handle.scaleStart.length !== 2)
                throw new Error(`Puppet2D IK handle "${handle.componentId}" has invalid initial scales.`);

            for (const scale of handle.scaleStart)
                AnimatorRuntimeUtils.requireFiniteVector(scale, 3, `Puppet2D IK handle "${handle.componentId}" initial scale`);

            AnimatorRuntimeUtils.requireFiniteVector(handle.offsetScale, 3, `Puppet2D IK handle "${handle.componentId}" scale offset`);
            AnimatorRuntimeUtils.requireFiniteVector(handle.offsetRotation, 4, `Puppet2D IK handle "${handle.componentId}" rotation offset`);

            AnimatorQuaternion.normalized(handle.offsetRotation);
        }
    }

    private setWorldRotation(transformId: string, worldRotation: readonly number[], mirroredPlanarJointSpace: boolean) {
        if (mirroredPlanarJointSpace)
        {
            this.setMirroredPlanarWorldRotation(transformId, worldRotation);
            return;
        }

        const transform = this.requireTransform(transformId);
        let localRotation = AnimatorQuaternion.normalized(worldRotation);

        if (transform.parentId)
        {
            const inverseParentRotation = AnimatorQuaternion.inverted(this.hierarchy.requireWorldRotation(transform.parentId));
            localRotation = AnimatorQuaternion.multiplied(inverseParentRotation, localRotation);
        }

        const destination = this.state.requireTransform(transformId).localRotation;
        AnimatorRuntimeUtils.copyFiniteVector(destination, localRotation, destination.length, "Puppet2D IK vector");
    }

    private setMirroredPlanarWorldRotation(transformId: string, worldRotation: readonly number[]) {
        const transform = this.requireTransform(transformId);
        if (!transform.parentId)
            throw new Error(`Mirrored Puppet2D IK Transform "${transformId}" has no parent.`);

        const normalizedRotation = AnimatorQuaternion.normalized(worldRotation);
        const x = normalizedRotation[0];
        const y = normalizedRotation[1];
        const z = normalizedRotation[2];
        const w = normalizedRotation[3];

        const worldDirectionX = 2 * (x * y - z * w);
        const worldDirectionY = 1 - 2 * (x * x + z * z);

        const parentWorld = this.hierarchy.requireWorldMatrix(transform.parentId);
        const determinant = parentWorld[0] * parentWorld[5] - parentWorld[1] * parentWorld[4];

        if (Math.abs(determinant) <= this.EPSILON)
            throw new Error(`Mirrored Puppet2D IK Transform "${transformId}" has a singular parent transform.`);

        const localDirectionX = (parentWorld[5] * worldDirectionX - parentWorld[1] * worldDirectionY) / determinant;
        const localDirectionY = (-parentWorld[4] * worldDirectionX + parentWorld[0] * worldDirectionY) / determinant;

        if (Math.hypot(localDirectionX, localDirectionY) <= this.EPSILON)
            throw new Error(`Mirrored Puppet2D IK Transform "${transformId}" has an invalid local direction.`);

        const localAngle = Math.atan2(-localDirectionX, localDirectionY) * 180 / Math.PI;
        const localRotation = AnimatorQuaternion.angleAxis(localAngle, this.FORWARD);
        const destination = this.state.requireTransform(transformId).localRotation;

        AnimatorRuntimeUtils.copyFiniteVector(destination, localRotation, destination.length, "Puppet2D IK vector");
    }

    private getWorldPosition(transformId: string): number[] {
        const matrix = this.hierarchy.requireWorldMatrix(transformId);

        return [
            matrix[3],
            matrix[7],
            matrix[11]
        ];
    }

    private subtract(left: readonly number[], right: readonly number[]): number[] {
        return [
            left[0] - right[0],
            left[1] - right[1],
            left[2] - right[2]
        ];
    }

    private distance(left: readonly number[], right: readonly number[]): number {
        return Math.hypot(
            left[0] - right[0],
            left[1] - right[1],
            left[2] - right[2]
        );
    }

    private requireNonZeroVector(value: readonly number[], context: string) {
        if (Math.hypot(...value) <= this.EPSILON)
            throw new Error(`${context} has zero length.`);
    }

    private requireTransform(transformId: string): AnimatorRuntimeTransform {
        const transform = this.transformsById.get(transformId);
        if (!transform)
            throw new Error(`Puppet2D IK references missing Transform "${transformId}".`);

        return transform;
    }

    private usesMirroredPlanarJointSpace(handle: AnimatorRuntimePuppet2DIkHandle): boolean {
        const initialTopScale = handle.scaleStart[0];
        return initialTopScale[0] * initialTopScale[1] < 0;
    }
}
