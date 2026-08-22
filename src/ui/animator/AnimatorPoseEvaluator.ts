import type {
    AnimatorBindingDiagnostic,
    AnimatorBindingResolution,
    AnimatorRuntimeScene,
    ResolvedAnimatorBinding,
    ResolvedAnimatorObjectReference,
    AnimatorRuntimeAnimator
} from "./AnimatorBindingResolver";
import type { AnimatorClipSample, AnimatorLayerDefinition } from "./AnimatorControllerEvaluator";
import type { AnimatorSampleableClip, AnimatorSampledClip } from "./AnimatorAnimationSampler";

import { AnimatorAnimationSampler } from "./AnimatorAnimationSampler";
import { AnimatorBindingResolver } from "./AnimatorBindingResolver";

export type AnimatorNumericPoseChannel = Readonly<{
    key: string;
    binding: ResolvedAnimatorBinding;
    values: readonly (number | null)[];
    componentWeights: readonly number[];
}>;

export type AnimatorObjectReferencePoseChannel = Readonly<{
    key: string;
    binding: ResolvedAnimatorBinding;
    reference: ResolvedAnimatorObjectReference | null;
    weight: number;
}>;

export type AnimatorLayerPose = Readonly<{
    controllerId: string;
    layerIndex: number;
    layerWeight: number;
    blendingMode: AnimatorLayerDefinition["blendingMode"];
    numericChannels: readonly AnimatorNumericPoseChannel[];
    objectReferenceChannels: readonly AnimatorObjectReferencePoseChannel[];
}>;

export type AnimatorEvaluatedPose = Readonly<{
    animatorId: string;
    layers: readonly AnimatorLayerPose[];
    diagnostics: readonly AnimatorBindingDiagnostic[];
}>;

type MutableNumericChannel = {
    binding: ResolvedAnimatorBinding;
    weightedValues: number[];
    weights: number[];
    quaternionReference: number[] | null;
};

type MutableObjectReferenceCandidate = {
    reference: ResolvedAnimatorObjectReference | null;
    weight: number;
    lastOrder: number;
};

type MutableObjectReferenceChannel = {
    binding: ResolvedAnimatorBinding;
    candidates: Map<string, MutableObjectReferenceCandidate>;
};

type MutableLayerPose = {
    controllerId: string;
    layerIndex: number;
    layerWeight: number;
    blendingMode: AnimatorLayerDefinition["blendingMode"];
    numericChannels: Map<string, MutableNumericChannel>;
    objectReferenceChannels: Map<string, MutableObjectReferenceChannel>;
};

export class AnimatorPoseEvaluator {
    private readonly EPSILON = 0.000001;
    private readonly bindingResolver: AnimatorBindingResolver;
    private readonly animatorsById: Map<string, AnimatorRuntimeAnimator>;
    private readonly resolutions = new Map<string, AnimatorBindingResolution>();

    constructor(private readonly scene: AnimatorRuntimeScene, private readonly animationSampler: AnimatorAnimationSampler) {
        this.bindingResolver = new AnimatorBindingResolver(scene);
        this.animatorsById = new Map(scene.animators.map((animator) => [animator.id, animator]));
    }

    evaluate(animatorId: string, clipSamples: readonly AnimatorClipSample[]): AnimatorEvaluatedPose {
        const animator = this.animatorsById.get(animatorId);
        if (!animator)
            throw new Error(`Animator "${animatorId}" does not exist.`);

        const layers = new Map<string, MutableLayerPose>();
        const diagnostics: AnimatorBindingDiagnostic[] = [];
        const diagnosticKeys = new Set<string>();
        let objectReferenceOrder = 0;

        for (const clipSample of clipSamples)
        {
            if (!Number.isFinite(clipSample.weight) || clipSample.weight < 0)
                throw new Error("An Animator clip sample has an invalid weight.");

            if (clipSample.weight <= this.EPSILON)
                continue;

            if (animator.controllerId !== clipSample.controllerId)
                throw new Error(`Animator "${animatorId}" does not use controller "${clipSample.controllerId}".`);

            const clip = this.animationSampler.getClip(clipSample.clipId);
            if (!clip)
                throw new Error(`AnimationClip "${clipSample.clipName}" is missing from the animation package.`);

            const resolution = this.getResolution(animatorId, clip);
            const sampledClip = this.animationSampler.sampleClip(clip, clipSample.clipTime);

            this.appendDiagnostics(diagnostics, diagnosticKeys, resolution.diagnostics);

            const layer = this.getLayer(layers, clipSample);

            this.accumulateNumericBindings(layer, sampledClip, resolution, clipSample.weight);

            objectReferenceOrder = this.accumulateObjectReferences(layer, clip, sampledClip, resolution, clipSample.weight, objectReferenceOrder);
        }

        return {
            animatorId,
            layers: [...layers.values()]
                .sort((left, right) => left.layerIndex - right.layerIndex)
                .map((layer) => this.finalizeLayer(layer)),
            diagnostics
        };
    }

    getGameObjectActivationTargets(animatorId: string, clipIds: readonly string[]): ReadonlySet<string> {
        const result = new Set<string>();

        for (const clipId of new Set(clipIds))
        {
            const clip = this.animationSampler.getClip(clipId);
            if (!clip)
                throw new Error(`AnimationClip "${clipId}" does not exist.`);

            const resolution = this.getResolution(animatorId, clip);

            for (const binding of resolution.bindings)
            {
                if (binding?.property.kind === "gameObjectActive")
                    result.add(binding.targetGameObjectId);
            }
        }

        return result;
    }

    clearResolutionCache() {
        this.resolutions.clear();
    }

    private getResolution(animatorId: string, clip: AnimatorSampleableClip): AnimatorBindingResolution {
        const key = `${animatorId}\0${clip.pathId}`;
        const existing = this.resolutions.get(key);

        if (existing)
            return existing;

        const initialSample = this.animationSampler.sampleClip(clip, 0);
        const resolution = this.bindingResolver.resolve(animatorId, clip, initialSample.numericValues);

        this.resolutions.set(key, resolution);

        return resolution;
    }

    private getLayer(layers: Map<string, MutableLayerPose>, sample: AnimatorClipSample): MutableLayerPose {
        const key = `${sample.controllerId}\0${sample.layerIndex}`;
        const existing = layers.get(key);

        if (existing)
        {
            if (existing.blendingMode !== sample.blendingMode)
                throw new Error("Animator samples disagree about the layer blending mode.");

            existing.layerWeight = Math.max(existing.layerWeight, sample.layerWeight);
            return existing;
        }

        const layer: MutableLayerPose = {
            controllerId: sample.controllerId,
            layerIndex: sample.layerIndex,
            layerWeight: sample.layerWeight,
            blendingMode: sample.blendingMode,
            numericChannels: new Map(),
            objectReferenceChannels: new Map()
        };

        layers.set(key, layer);
        return layer;
    }

    private accumulateNumericBindings(layer: MutableLayerPose, sampledClip: AnimatorSampledClip, resolution: AnimatorBindingResolution, weight: number) {
        const valuesByBinding = new Map<number, (number | null)[]>();

        for (const sampledValue of sampledClip.numericValues)
        {
            const binding = resolution.bindings[sampledValue.bindingIndex];
            if (!binding)
                continue;

            let values = valuesByBinding.get(sampledValue.bindingIndex);

            if (!values)
            {
                values = Array.from({ length: binding.scalarCount }, () => null);
                valuesByBinding.set(sampledValue.bindingIndex, values);
            }

            if (sampledValue.componentIndex < 0 || sampledValue.componentIndex >= values.length)
                throw new Error(`AnimationClip "${sampledClip.clipName}" sampled an invalid binding component.`);

            values[sampledValue.componentIndex] = sampledValue.value;
        }

        for (const [bindingIndex, values] of valuesByBinding)
        {
            const binding = resolution.bindings[bindingIndex];

            if (!binding)
                continue;

            const key = this.createBindingKey(binding);
            let channel = layer.numericChannels.get(key);

            if (!channel)
            {
                channel = {
                    binding,
                    weightedValues: Array.from({ length: binding.scalarCount }, () => 0),
                    weights: Array.from({ length: binding.scalarCount }, () => 0),
                    quaternionReference: null
                };

                layer.numericChannels.set(key, channel);
            }
            else
            {
                this.ensureCompatibleBindings(channel.binding, binding);
            }

            const preparedValues = this.prepareNumericValues(binding, values, channel);
            for (let componentIndex = 0; componentIndex < preparedValues.length; componentIndex++)
            {
                const value = preparedValues[componentIndex];

                if (value === null)
                    continue;

                channel.weightedValues[componentIndex] += value * weight;
                channel.weights[componentIndex] += weight;
            }
        }
    }

    private prepareNumericValues(
        binding: ResolvedAnimatorBinding,
        values: readonly (number | null)[],
        channel: MutableNumericChannel
    ): readonly (number | null)[] {
        if (
            binding.property.kind !== "transform" ||
            binding.property.property !== "rotation" ||
            values.length !== 4 ||
            values.some((value) => value === null)
        )
        {
            return values;
        }

        const quaternion = values.map((value) => value) as number[];
        const magnitude = Math.hypot(...quaternion);

        if (magnitude <= this.EPSILON)
            return values;

        for (let i = 0; i < quaternion.length; i++)
            quaternion[i] /= magnitude;

        if (!channel.quaternionReference)
        {
            channel.quaternionReference = [...quaternion];
            return quaternion;
        }

        const dot = quaternion.reduce((result, component, index) => result + component * channel.quaternionReference![index], 0);

        if (dot < 0)
        {
            for (let i = 0; i < quaternion.length; i++)
                quaternion[i] *= -1;
        }

        return quaternion;
    }

    private accumulateObjectReferences(
        layer: MutableLayerPose,
        clip: AnimatorSampleableClip,
        sampledClip: AnimatorSampledClip,
        resolution: AnimatorBindingResolution,
        weight: number,
        initialOrder: number
    ): number {
        let order = initialOrder;

        for (const sampledReference of sampledClip.objectReferences)
        {
            order++;

            const binding = resolution.bindings[sampledReference.bindingIndex];
            if (!binding)
                continue;

            const reference = this.resolveSampledObjectReference(clip, resolution, sampledReference.mappingIndex);
            if (reference === undefined)
                continue;

            this.ensureReferenceCompatible(binding, reference);

            const key = this.createBindingKey(binding);
            let channel = layer.objectReferenceChannels.get(key);

            if (!channel)
            {
                channel = {
                    binding,
                    candidates: new Map()
                };

                layer.objectReferenceChannels.set(key, channel);
            }
            else
            {
                this.ensureCompatibleBindings(channel.binding, binding);
            }

            const referenceKey = this.createObjectReferenceKey(reference);
            const candidate = channel.candidates.get(referenceKey);

            if (candidate)
            {
                candidate.weight += weight;
                candidate.lastOrder = order;
            }
            else
            {
                channel.candidates.set(referenceKey, {
                    reference,
                    weight,
                    lastOrder: order
                });
            }
        }

        return order;
    }

    private resolveSampledObjectReference(clip: AnimatorSampleableClip, resolution: AnimatorBindingResolution, mappingIndex: number): ResolvedAnimatorObjectReference | null | undefined {
        if (mappingIndex === -1)
            return null;

        const sourceReference = clip.pptrCurveMapping[mappingIndex];
        if (sourceReference === undefined)
            throw new Error("An animation selected an invalid PPtr mapping.");

        const resolvedReference = resolution.objectReferences[mappingIndex];
        if (sourceReference !== null && resolvedReference === null)
            return undefined;

        return resolvedReference;
    }

    private ensureReferenceCompatible(binding: ResolvedAnimatorBinding, reference: ResolvedAnimatorObjectReference | null) {
        if (reference === null)
            return;
        if (binding.property.kind === "materialReference" && reference.kind === "material")
            return;
        if (binding.property.kind === "spriteReference" && reference.kind === "sprite")
            return;

        throw new Error("An animation object reference is incompatible with its binding.");
    }

    private finalizeLayer(layer: MutableLayerPose): AnimatorLayerPose {
        return {
            controllerId: layer.controllerId,
            layerIndex: layer.layerIndex,
            layerWeight: layer.layerWeight,
            blendingMode: layer.blendingMode,
            numericChannels: [...layer.numericChannels.entries()].map(([key, channel]) => this.finalizeNumericChannel(key, channel)),
            objectReferenceChannels:
                [...layer.objectReferenceChannels.entries()]
                    .map(([key, channel]) => this.finalizeObjectReferenceChannel(key, channel))
                    .filter((channel): channel is AnimatorObjectReferencePoseChannel => channel !== null)
        };
    }

    private finalizeNumericChannel(key: string, channel: MutableNumericChannel): AnimatorNumericPoseChannel {
        const values = channel.weightedValues.map((weightedValue, index) => {
            const weight = channel.weights[index];

            return weight > this.EPSILON
                ? weightedValue / weight
                : null;
        });

        if (
            channel.binding.property.kind === "transform" &&
            channel.binding.property.property === "rotation" &&
            values.length === 4 &&
            values.every((value) => value !== null)
        )
        {
            const quaternion = values as number[];
            const magnitude = Math.hypot(...quaternion);

            if (magnitude > this.EPSILON)
            {
                for (let i = 0; i < quaternion.length; i++)
                    quaternion[i] /= magnitude;
            }
        }

        return {
            key,
            binding: channel.binding,
            values,
            componentWeights: channel.weights.map((weight) => Math.min(1, Math.max(0, weight)))
        };
    }

    private finalizeObjectReferenceChannel(key: string, channel: MutableObjectReferenceChannel): AnimatorObjectReferencePoseChannel | null {
        let selected: MutableObjectReferenceCandidate | null = null;

        for (const candidate of channel.candidates.values())
        {
            if (
                !selected ||
                candidate.weight > selected.weight ||
                (
                    candidate.weight === selected.weight &&
                    candidate.lastOrder > selected.lastOrder
                )
            )
            {
                selected = candidate;
            }
        }

        if (!selected)
            return null;

        return {
            key,
            binding: channel.binding,
            reference: selected.reference,
            weight: Math.min(1, Math.max(0, selected.weight))
        };
    }

    private createBindingKey(binding: ResolvedAnimatorBinding): string {
        const property = binding.property;

        switch (property.kind)
        {
            case "gameObjectActive":
                return JSON.stringify([
                    property.kind,
                    binding.targetGameObjectId
                ]);

            case "transform":
                return JSON.stringify([
                    property.kind,
                    binding.targetTransformId,
                    property.property
                ]);

            case "rendererEnabled":
            case "rendererSortingOrder":
                return JSON.stringify([
                    property.kind,
                    property.rendererId
                ]);

            case "spriteRendererColor":
                return JSON.stringify([
                    property.kind,
                    property.rendererId,
                    property.component
                ]);

            case "spriteRendererFlip":
                return JSON.stringify([
                    property.kind,
                    property.rendererId,
                    property.axis
                ]);

            case "spriteRendererSize":
                return JSON.stringify([
                    property.kind,
                    property.rendererId,
                    property.component
                ]);

            case "blendShape":
                return JSON.stringify([
                    property.kind,
                    property.rendererId,
                    property.meshId,
                    property.blendShapeIndex
                ]);

            case "materialProperty":
                return JSON.stringify([
                    property.kind,
                    property.rendererId,
                    property.propertyName,
                    property.propertyType,
                    property.component,
                    property.materialSlots
                ]);

            case "materialReference":
                return JSON.stringify([
                    property.kind,
                    property.rendererId,
                    property.materialSlot
                ]);

            case "spriteReference":
                return JSON.stringify([
                    property.kind,
                    property.rendererId
                ]);

            case "particleShapeRadius":
                return JSON.stringify([
                    property.kind,
                    property.particleSystemId
                ]);

            case "puppet2dIkFlip":
                return JSON.stringify([
                    property.kind,
                    property.componentId
                ]);
        }
    }

    private createObjectReferenceKey(reference: ResolvedAnimatorObjectReference | null): string {
        if (reference === null)
            return "null";

        return reference.kind === "material"
            ? `material:${reference.materialId}`
            : `sprite:${reference.spriteId}`;
    }

    private ensureCompatibleBindings(existing: ResolvedAnimatorBinding, incoming: ResolvedAnimatorBinding) {
        if (
            existing.scalarCount !== incoming.scalarCount ||
            existing.components.length !== incoming.components.length ||
            existing.components.some((component, index) => component !== incoming.components[index])
        )
        {
            throw new Error("Animation clips use incompatible bindings for the same property.");
        }
    }

    private appendDiagnostics(destination: AnimatorBindingDiagnostic[], keys: Set<string>, diagnostics: readonly AnimatorBindingDiagnostic[]) {
        for (const diagnostic of diagnostics)
        {
            const key = JSON.stringify([
                diagnostic.clipName,
                diagnostic.bindingIndex,
                diagnostic.mappingIndex,
                diagnostic.message
            ]);

            if (keys.has(key))
                continue;

            keys.add(key);
            destination.push(diagnostic);
        }
    }
}
