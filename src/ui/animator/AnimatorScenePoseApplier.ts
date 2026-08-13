import type { AnimatorEvaluatedPose, AnimatorLayerPose, AnimatorNumericPoseChannel, AnimatorObjectReferencePoseChannel } from "./AnimatorPoseEvaluator";
import type { AnimatorMaterialPropertyValue } from "./AnimatorSceneState";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";
import { AnimatorQuaternion } from "./AnimatorQuaternion";
import { AnimatorSceneState } from "./AnimatorSceneState";

export type AnimatorPoseApplicationResult = Readonly<{
    state: AnimatorSceneState;
    diagnostics: readonly string[];
}>;

export class AnimatorScenePoseApplier {
    private readonly EPSILON = 0.000001;

    constructor(readonly state: AnimatorSceneState) {}

    apply(poses: readonly AnimatorEvaluatedPose[]): AnimatorPoseApplicationResult {
        this.state.reset();

        const diagnostics: string[] = [];
        const diagnosticKeys = new Set<string>();

        for (const pose of poses)
        {
            for (const layer of pose.layers)
            {
                if (layer.blendingMode !== "override")
                {
                    AnimatorRuntimeUtils.appendUniqueString(
                        diagnostics,
                        diagnosticKeys,
                        `Animator "${pose.animatorId}" layer ${layer.layerIndex} uses the unsupported "${layer.blendingMode}" blending mode.`
                    );

                    continue;
                }

                this.applyNumericChannels(layer, diagnostics, diagnosticKeys);
                this.applyObjectReferenceChannels(layer);
            }
        }

        return {
            state: this.state,
            diagnostics
        };
    }

    private applyNumericChannels(layer: AnimatorLayerPose, diagnostics: string[], diagnosticKeys: Set<string>) {
        for (const channel of layer.numericChannels)
        {
            const property = channel.binding.property;

            switch (property.kind)
            {
                case "gameObjectActive":
                    this.applyGameObjectActive(channel);
                    break;

                case "transform":
                    this.applyTransform(channel);
                    break;

                case "rendererEnabled":
                    this.applyRendererEnabled(channel);
                    break;

                case "rendererSortingOrder":
                    this.applyRendererSortingOrder(channel);
                    break;

                case "spriteRendererColor":
                    this.applySpriteRendererColor(channel);
                    break;

                case "spriteRendererFlip":
                    this.applySpriteRendererFlip(channel);
                    break;

                case "spriteRendererSize":
                    this.applySpriteRendererSize(channel);
                    break;

                case "blendShape":
                    this.applyBlendShape(channel);
                    break;

                case "materialProperty":
                    this.applyMaterialProperty(channel, diagnostics, diagnosticKeys);
                    break;

                case "materialReference":
                case "spriteReference":
                    throw new Error("An object-reference binding was sampled as a numeric channel.");
            }
        }
    }

    private applyObjectReferenceChannels(layer: AnimatorLayerPose) {
        for (const channel of layer.objectReferenceChannels)
        {
            if (channel.weight + this.EPSILON < 0.5)
                continue;

            this.applyObjectReference(channel);
        }
    }

    private applyGameObjectActive(channel: AnimatorNumericPoseChannel) {
        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const state = this.state.requireGameObject(channel.binding.targetGameObjectId);
        state.active = this.blendBoolean(state.active, sample.value, sample.weight);
    }

    private applyTransform(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "transform")
            throw new Error("The transform channel is invalid.");

        const state = this.state.requireTransform(channel.binding.targetTransformId);

        switch (property.property)
        {
            case "position":
                this.applyVectorComponents(state.localPosition, channel, ["x", "y", "z"]);
                break;
            case "scale":
                this.applyVectorComponents(state.localScale, channel, ["x", "y", "z"]);
                break;
            case "rotation":
                this.applyQuaternion(state.localRotation, channel);
                break;
            case "euler":
                this.applyEulerRotation(state.localRotation, channel);
                break;
        }
    }

    private applyRendererEnabled(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "rendererEnabled")
            throw new Error("The renderer-enabled channel is invalid.");

        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const renderer = this.state.requireRenderer(property.rendererId, property.rendererType);
        renderer.enabled = this.blendBoolean(renderer.enabled, sample.value, sample.weight);
    }

    private applyRendererSortingOrder(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "rendererSortingOrder")
            throw new Error("The renderer sorting-order channel is invalid.");

        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const renderer = this.state.requireRenderer(property.rendererId, property.rendererType);
        renderer.sortingOrder = Math.round(this.lerp(renderer.sortingOrder, sample.value, sample.weight));
    }

    private applySpriteRendererColor(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "spriteRendererColor")
            throw new Error("The SpriteRenderer color channel is invalid.");

        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const renderer = this.state.requireSpriteRenderer(property.rendererId);
        const componentIndex = this.getComponentIndex(property.component, ["r", "g", "b", "a"]);

        renderer.color[componentIndex] = this.lerp(renderer.color[componentIndex], sample.value, sample.weight);
    }

    private applySpriteRendererFlip(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "spriteRendererFlip")
            throw new Error("The SpriteRenderer flip channel is invalid.");

        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const renderer = this.state.requireSpriteRenderer(property.rendererId);

        if (property.axis === "x")
            renderer.flipX = this.blendBoolean(renderer.flipX, sample.value, sample.weight);
        else
            renderer.flipY = this.blendBoolean(renderer.flipY, sample.value, sample.weight);
    }

    private applySpriteRendererSize(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "spriteRendererSize")
            throw new Error("The SpriteRenderer size channel is invalid.");

        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const renderer = this.state.requireSpriteRenderer(property.rendererId);
        const componentIndex = this.getComponentIndex(property.component, ["x", "y"]);

        renderer.size[componentIndex] = this.lerp(renderer.size[componentIndex], sample.value, sample.weight);
    }

    private applyBlendShape(channel: AnimatorNumericPoseChannel) {
        const property = channel.binding.property;
        if (property.kind !== "blendShape")
            throw new Error("The blend-shape channel is invalid.");

        const sample = this.getScalarSample(channel);
        if (!sample)
            return;

        const renderer = this.state.requireSkinnedMeshRenderer(property.rendererId);
        if (property.blendShapeIndex < 0 || property.blendShapeIndex >= renderer.blendShapeWeights.length)
            throw new Error(`Blend shape "${property.blendShapeName}" has an invalid index.`);

        renderer.blendShapeWeights[property.blendShapeIndex] = this.lerp(
            renderer.blendShapeWeights[property.blendShapeIndex],
            sample.value,
            sample.weight
        );
    }

    private applyMaterialProperty(channel: AnimatorNumericPoseChannel, diagnostics: string[], diagnosticKeys: Set<string>) {
        const property = channel.binding.property;
        if (property.kind !== "materialProperty")
            throw new Error("The material-property channel is invalid.");

        for (const materialSlot of property.materialSlots)
        {
            const current = this.state.getMaterialPropertyValue(
                property.rendererId,
                property.rendererType,
                materialSlot,
                property.propertyName,
                property.propertyType
            );

            if (current === null)
            {
                AnimatorRuntimeUtils.appendUniqueString(
                    diagnostics,
                    diagnosticKeys,
                    `Material property "${property.propertyName}" is unavailable on renderer "${property.rendererId}" slot ${materialSlot}.`
                );

                continue;
            }

            const result = this.blendMaterialProperty(current, channel);
            if (result === null)
                continue;

            this.state.setMaterialPropertyOverride(property.rendererId, property.rendererType, materialSlot, property.propertyName, result);
        }
    }

    private blendMaterialProperty(current: AnimatorMaterialPropertyValue, channel: AnimatorNumericPoseChannel): AnimatorMaterialPropertyValue | null {
        const property = channel.binding.property;
        if (property.kind !== "materialProperty")
            throw new Error("The material-property channel is invalid.");

        if (property.propertyType === "float" || property.propertyType === "integer") {
            if (typeof current !== "number")
                throw new Error("A scalar material property has a vector value.");

            const sample = this.getScalarSample(channel);
            if (!sample)
                return null;

            const value = this.lerp(current, sample.value, sample.weight);

            return property.propertyType === "integer"
                ? Math.round(value)
                : value;
        }

        if (!Array.isArray(current) || current.length !== 4)
            throw new Error("A vector material property has an invalid value.");
        if (!property.component)
            throw new Error("A vector material binding has no component.");

        const componentIndex = this.getComponentIndex(
            property.component,
            property.propertyType === "vector"
                ? ["r", "g", "b", "a"]
                : ["x", "y", "z", "w"]
        );

        const sample = this.getScalarSample(channel);
        if (!sample)
            return null;

        const result = [...current];

        result[componentIndex] = this.lerp(result[componentIndex], sample.value, sample.weight);
        return result;
    }

    private applyObjectReference(channel: AnimatorObjectReferencePoseChannel) {
        const property = channel.binding.property;

        if (property.kind === "materialReference")
        {
            const renderer = this.state.requireRenderer(property.rendererId, property.rendererType);

            AnimatorRuntimeUtils.requireMaterialSlot(renderer, property.materialSlot);

            if (channel.reference !== null && channel.reference.kind !== "material")
                throw new Error("A material binding selected a non-material reference.");

            renderer.materialIds[property.materialSlot] = channel.reference?.materialId ?? null;
            return;
        }

        if (property.kind === "spriteReference")
        {
            if (channel.reference !== null && channel.reference.kind !== "sprite")
                throw new Error("A Sprite binding selected a non-Sprite reference.");

            const renderer = this.state.requireSpriteRenderer(property.rendererId);
            renderer.spriteId = channel.reference?.spriteId ?? null;

            return;
        }

        throw new Error("A numeric binding was sampled as an object-reference channel.");
    }

    private applyVectorComponents(destination: number[], channel: AnimatorNumericPoseChannel, componentNames: readonly string[]) {
        for (let i = 0; i < channel.values.length; i++)
        {
            const value = channel.values[i];
            const weight = channel.componentWeights[i];

            if (value === null || weight === undefined || weight <= this.EPSILON)
                continue;

            const componentName = channel.binding.components[i];
            if (!componentName)
                throw new Error("A vector binding component is missing.");

            const destinationIndex = this.getComponentIndex(componentName, componentNames);

            destination[destinationIndex] = this.lerp(destination[destinationIndex], value, weight);
        }
    }

    private applyQuaternion(destination: number[], channel: AnimatorNumericPoseChannel) {
        if (destination.length !== 4 || channel.values.length !== 4)
            throw new Error("A quaternion animation has an invalid size.");

        const target = [...destination];
        let minimumWeight = 1;
        let populatedComponents = 0;

        for (let i = 0; i < channel.values.length; i++)
        {
            const value = channel.values[i];
            const weight = channel.componentWeights[i];

            if (value === null || weight === undefined || weight <= this.EPSILON)
                continue;

            const componentName = channel.binding.components[i];
            if (!componentName)
                throw new Error("A quaternion component is missing.");

            const targetIndex = this.getComponentIndex(componentName, ["x", "y", "z", "w"]);

            target[targetIndex] = value;
            minimumWeight = Math.min(minimumWeight, weight);
            populatedComponents++;
        }

        if (populatedComponents === 0)
            return;

        const normalizedTarget = AnimatorQuaternion.normalized(target);

        if (populatedComponents === 4)
        {
            const result = this.slerpQuaternion(destination, normalizedTarget, minimumWeight);

            this.copyValues(destination, result);
            return;
        }

        for (let i = 0; i < channel.values.length; i++)
        {
            const value = channel.values[i];
            const weight = channel.componentWeights[i];

            if (value === null || weight === undefined || weight <= this.EPSILON)
                continue;

            const componentName = channel.binding.components[i];
            const destinationIndex = this.getComponentIndex(componentName, ["x", "y", "z", "w"]);

            destination[destinationIndex] = this.lerp(destination[destinationIndex], normalizedTarget[destinationIndex], weight);
        }

        this.copyValues(destination, AnimatorQuaternion.normalized(destination));
    }

    private applyEulerRotation(destination: number[], channel: AnimatorNumericPoseChannel) {
        const euler = this.quaternionToEulerZxy(destination);

        this.applyVectorComponents(euler, channel, ["x", "y", "z"]);
        this.copyValues(destination, this.eulerZxyToQuaternion(euler));
    }

    private getScalarSample(channel: AnimatorNumericPoseChannel): Readonly<{ value: number; weight: number; }> | null {
        const value = channel.values[0];
        const weight = channel.componentWeights[0];

        if (value === null || value === undefined || weight === undefined || weight <= this.EPSILON)
            return null;

        return {
            value,
            weight
        };
    }

    private blendBoolean(current: boolean, target: number, weight: number): boolean {
        return this.lerp(current ? 1 : 0, target, weight) >= 0.5;
    }

    private lerp(start: number, end: number, weight: number): number {
        return AnimatorRuntimeUtils.lerp(start, end, AnimatorRuntimeUtils.clamp01(weight));
    }

    private slerpQuaternion(startValue: readonly number[], endValue: readonly number[], weight: number): number[] {
        const start = AnimatorQuaternion.normalized(startValue);
        let end = AnimatorQuaternion.normalized(endValue);
        let dot = start.reduce((result, component, index) => result + component * end[index], 0);

        if (dot < 0)
        {
            end = end.map((component) => -component);
            dot = -dot;
        }

        dot = Math.min(1, Math.max(-1, dot));

        if (dot > 0.9995)
            return AnimatorQuaternion.normalized(start.map((component, index) => this.lerp(component, end[index], weight)));

        const angle = Math.acos(dot);
        const sine = Math.sin(angle);

        if (Math.abs(sine) <= this.EPSILON)
            return start;

        const clampedWeight = Math.min(1, Math.max(0, weight));
        const startWeight = Math.sin((1 - clampedWeight) * angle) / sine;
        const endWeight = Math.sin(clampedWeight * angle) / sine;

        return start.map((component, index) => component * startWeight + end[index] * endWeight);
    }

    private eulerZxyToQuaternion(eulerDegrees: readonly number[]): number[] {
        if (eulerDegrees.length !== 3)
            throw new Error("An Euler rotation is invalid.");

        const halfX = this.degreesToRadians(eulerDegrees[0]) / 2;
        const halfY = this.degreesToRadians(eulerDegrees[1]) / 2;
        const halfZ = this.degreesToRadians(eulerDegrees[2]) / 2;

        const rotationX = [
            Math.sin(halfX),
            0,
            0,
            Math.cos(halfX)
        ];
        const rotationY = [
            0,
            Math.sin(halfY),
            0,
            Math.cos(halfY)
        ];
        const rotationZ = [
            0,
            0,
            Math.sin(halfZ),
            Math.cos(halfZ)
        ];

        return AnimatorQuaternion.normalized(AnimatorQuaternion.multiplied(rotationY, AnimatorQuaternion.multiplied(rotationX, rotationZ)));
    }

    private quaternionToEulerZxy(quaternionValue: readonly number[]): number[] {
        const [x, y, z, w] = AnimatorQuaternion.normalized(quaternionValue);

        const matrix00 = 1 - 2 * (y * y + z * z);
        const matrix02 = 2 * (x * z + y * w);
        const matrix10 = 2 * (x * y + z * w);
        const matrix11 = 1 - 2 * (x * x + z * z);
        const matrix12 = 2 * (y * z - x * w);
        const matrix20 = 2 * (x * z - y * w);
        const matrix22 = 1 - 2 * (x * x + y * y);

        const rotationX = Math.asin(Math.min(1, Math.max(-1, -matrix12)));
        const cosineX = Math.cos(rotationX);

        let rotationY: number;
        let rotationZ: number;

        if (Math.abs(cosineX) > this.EPSILON)
        {
            rotationY = Math.atan2(matrix02, matrix22);
            rotationZ = Math.atan2(matrix10, matrix11);
        }
        else
        {
            rotationY = Math.atan2(-matrix20, matrix00);
            rotationZ = 0;
        }

        return [
            this.radiansToDegrees(rotationX),
            this.radiansToDegrees(rotationY),
            this.radiansToDegrees(rotationZ)
        ];
    }

    private degreesToRadians(value: number): number {
        return value * Math.PI / 180;
    }

    private radiansToDegrees(value: number): number {
        return value * 180 / Math.PI;
    }

    private getComponentIndex(component: string, supportedComponents: readonly string[]): number {
        const index = supportedComponents.indexOf(component);
        if (index < 0)
            throw new Error(`Animation component "${component}" is unsupported.`);

        return index;
    }

    private copyValues(destination: number[], source: readonly number[]) {
        if (destination.length !== source.length)
            throw new Error("Animation vectors have incompatible sizes.");

        for (let i = 0; i < source.length; i++)
            destination[i] = source[i];
    }
}
