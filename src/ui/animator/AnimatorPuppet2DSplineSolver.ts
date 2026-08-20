import type { AnimatorRuntimePuppet2DSplineControl, AnimatorRuntimeScene, AnimatorRuntimeTransform } from "./AnimatorBindingResolver";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import type { AnimatorSceneState } from "./AnimatorSceneState";

import { AnimatorTransformSpace } from "./AnimatorTransformSpace";
import { AnimatorQuaternion } from "./AnimatorQuaternion";

export class AnimatorPuppet2DSplineSolver {
    private readonly EPSILON = 0.000001;
    private readonly FORWARD = [0, 0, 1];
    private readonly LEFT = [-1, 0, 0];
    private readonly UP = [0, 1, 0];
    private readonly transformsById = new Map<string, AnimatorRuntimeTransform>();
    private readonly controls: readonly AnimatorRuntimePuppet2DSplineControl[];

    constructor(scene: AnimatorRuntimeScene, private readonly state: AnimatorSceneState, private readonly hierarchy: AnimatorTransformHierarchy) {
        for (const transform of scene.transforms)
            this.transformsById.set(transform.id, transform);

        this.validate(scene.puppet2dSplineControls);
        this.controls = scene.puppet2dSplineControls;
    }

    solve(): readonly string[] {
        const diagnostics: string[] = [];

        for (const control of this.controls)
        {
            const diagnostic = this.solveControl(control);

            if (diagnostic)
                diagnostics.push(diagnostic);
        }

        return diagnostics;
    }

    private solveControl(control: AnimatorRuntimePuppet2DSplineControl): string | null {
        const controlPositions = control.controlTransformIds.map((transformId) => AnimatorTransformSpace.getWorldPosition(this.hierarchy, transformId));
        const outputPositions = this.sampleCatmullRom(controlPositions, control.samples);
        const componentRotation = this.hierarchy.requireWorldRotation(control.componentTransformId);
        const yawRotation = AnimatorQuaternion.angleAxis(this.getEulerY(componentRotation), this.UP);

        for (let i = 0; i < control.boneTransformIds.length; i++)
        {
            const boneTransform = this.requireTransform(control.boneTransformIds[i]);
            let worldRotation: number[];

            if (i === 0)
            {
                worldRotation = [...this.hierarchy.requireWorldRotation(control.controlTransformIds[1])];
            }
            else if (i === outputPositions.length - 1)
            {
                worldRotation = [...this.hierarchy.requireWorldRotation(control.controlTransformIds[control.controlTransformIds.length - 2])];
            }
            else
            {
                const direction = this.subtract(outputPositions[i], outputPositions[i + 1]);

                if (Math.hypot(...direction) <= this.EPSILON)
                    return `Puppet2D spline control "${control.componentId}" contains overlapping output points ${i} and ${i + 1}.`;

                worldRotation = AnimatorQuaternion.multiplied(
                    AnimatorQuaternion.multiplied(AnimatorQuaternion.lookRotation(direction, this.FORWARD), AnimatorQuaternion.angleAxis(90, this.LEFT)),
                    yawRotation
                );
            }

            AnimatorTransformSpace.setWorldPosition(boneTransform, this.state, this.hierarchy, outputPositions[i]);
            AnimatorTransformSpace.setWorldRotation(boneTransform, this.state, this.hierarchy, worldRotation);

            this.hierarchy.update(this.state);
        }

        return null;
    }

    private sampleCatmullRom(controls: readonly (readonly number[])[], samples: number): number[][] {
        const result: number[][] = [];

        for (let i = 1; i < controls.length - 2; i++)
        {
            for (let sample = 0; sample < samples; sample++)
            {
                result.push(this.pointOnCurve(controls[i - 1], controls[i], controls[i + 1], controls[i + 2], sample / samples));
            }
        }

        result.push([...controls[controls.length - 2]]);
        return result;
    }

    private pointOnCurve(point0: readonly number[], point1: readonly number[], point2: readonly number[], point3: readonly number[], time: number): number[] {
        const coefficient0 = ((-time + 2) * time - 1) * time * 0.5;
        const coefficient1 = ((3 * time - 5) * time * time + 2) * 0.5;
        const coefficient2 = ((-3 * time + 4) * time + 1) * time * 0.5;
        const coefficient3 = (time - 1) * time * time * 0.5;

        return [0, 1, 2].map((axis) =>
            point0[axis] * coefficient0 +
            point1[axis] * coefficient1 +
            point2[axis] * coefficient2 +
            point3[axis] * coefficient3
        );
    }

    private getEulerY(rotation: readonly number[]): number {
        const [x, y, z, w] = AnimatorQuaternion.normalized(rotation);

        const matrix00 = 1 - 2 * (y * y + z * z);
        const matrix02 = 2 * (x * z + y * w);
        const matrix12 = 2 * (y * z - x * w);
        const matrix20 = 2 * (x * z - y * w);
        const matrix22 = 1 - 2 * (x * x + y * y);

        const rotationX = Math.asin(Math.min(1, Math.max(-1, -matrix12)));
        const cosineX = Math.cos(rotationX);
        const rotationY = Math.abs(cosineX) > this.EPSILON
            ? Math.atan2(matrix02, matrix22)
            : Math.atan2(-matrix20, matrix00);

        return rotationY * 180 / Math.PI;
    }

    private subtract(left: readonly number[], right: readonly number[]): number[] {
        return [
            left[0] - right[0],
            left[1] - right[1],
            left[2] - right[2]
        ];
    }

    private validate(controls: readonly AnimatorRuntimePuppet2DSplineControl[]) {
        const componentIds = new Set<string>();

        for (const control of controls)
        {
            if (componentIds.has(control.componentId))
                throw new Error(`Puppet2D spline control "${control.componentId}" is duplicated.`);

            componentIds.add(control.componentId);
            this.requireTransform(control.componentTransformId);

            if (control.controlTransformIds.length < 4)
                throw new Error(`Puppet2D spline control "${control.componentId}" has too few controls.`);
            if (!Number.isInteger(control.samples) || control.samples <= 0)
                throw new Error(`Puppet2D spline control "${control.componentId}" has an invalid sample count.`);

            for (const transformId of control.controlTransformIds)
                this.requireTransform(transformId);

            for (const transformId of control.boneTransformIds)
                this.requireTransform(transformId);

            const expectedCount = (control.controlTransformIds.length - 3) * control.samples + 1;

            if (control.boneTransformIds.length !== expectedCount)
                throw new Error(`Puppet2D spline control "${control.componentId}" has an invalid output count.`);
            if (new Set(control.boneTransformIds).size !== control.boneTransformIds.length) {
                throw new Error(`Puppet2D spline control "${control.componentId}" has duplicate output bones.`);
            }
        }
    }

    private requireTransform(transformId: string): AnimatorRuntimeTransform {
        const transform = this.transformsById.get(transformId);

        if (!transform)
            throw new Error(`Puppet2D spline control references missing Transform "${transformId}".`);

        return transform;
    }
}
