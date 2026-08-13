import type { AnimatorBindingClip, AnimatorBindingDefinition } from "./AnimatorBindingResolver";

export type AnimatorScalarCurveStorage =
    | "streamed"
    | "dense"
    | "constant";

export type AnimatorScalarCurveDefinition = Readonly<{
    bindingIndex: number;
    componentIndex: number;
    storage: AnimatorScalarCurveStorage;
    firstKey: number;
    keyCount: number;
}>;

export type AnimatorObjectReferenceCurveKey = Readonly<{
    time: number;
    mappingIndex: number;
}>;

export type AnimatorObjectReferenceCurveDefinition = Readonly<{
    bindingIndex: number;
    keys: readonly AnimatorObjectReferenceCurveKey[];
}>;

export type AnimatorSampleableClip = AnimatorBindingClip & Readonly<{
    pathId: string;
    duration: number;
    loop: boolean;
    scalarCurves: readonly AnimatorScalarCurveDefinition[];
    objectReferenceCurves: readonly AnimatorObjectReferenceCurveDefinition[];
}>;

export type AnimatorAnimationManifest = Readonly<{
    file: string;
    magic: string;
    keyRecordStride: number;
    keyCount: number;
    clips: readonly AnimatorSampleableClip[];
}>;

export type AnimatorSampledNumericValue = Readonly<{
    bindingIndex: number;
    componentIndex: number;
    value: number;
}>;

export type AnimatorSampledObjectReference = Readonly<{
    bindingIndex: number;
    mappingIndex: number;
}>;

export type AnimatorSampledClip = Readonly<{
    clipId: string;
    clipName: string;
    time: number;
    numericValues: readonly AnimatorSampledNumericValue[];
    objectReferences: readonly AnimatorSampledObjectReference[];
}>;

export class AnimatorAnimationSampler {
    private readonly MAGIC = "LORANM1";
    private readonly HEADER_SIZE = 8;
    private readonly KEY_RECORD_STRIDE = 28;
    private readonly MAXIMUM_KEY_COUNT = 50_000_000;
    private readonly TIME_OFFSET = 0;
    private readonly VALUE_OFFSET = 4;
    private readonly COEFFICIENT_0_OFFSET = 8;
    private readonly COEFFICIENT_1_OFFSET = 12;
    private readonly COEFFICIENT_2_OFFSET = 16;
    private readonly COEFFICIENT_3_OFFSET = 20;
    private readonly FLAGS_OFFSET = 24;
    private readonly FLAG_SAMPLED = 0;
    private readonly FLAG_CUBIC = 1;
    private readonly data: DataView;
    private readonly clipsById = new Map<string, AnimatorSampleableClip>();
    private readonly validatedClips = new WeakSet<object>();

    constructor(private readonly manifest: AnimatorAnimationManifest, binary: ArrayBuffer) {
        this.data = new DataView(binary);

        this.validateManifest();
        this.validateBinaryHeader();
        this.indexClips();
        this.validateCurveLayout();
    }

    getClip(clipId: string): AnimatorSampleableClip | null {
        return this.clipsById.get(clipId) ?? null;
    }

    sample(clipId: string, time: number): AnimatorSampledClip {
        const clip = this.clipsById.get(clipId);
        if (!clip)
            throw new Error(`AnimationClip "${clipId}" does not exist.`);

        return this.sampleClip(clip, time);
    }

    sampleClip(clip: AnimatorSampleableClip, time: number): AnimatorSampledClip {
        if (!Number.isFinite(time))
            throw new Error("Animation sample time must be finite.");

        this.validateClipData(clip);

        const sampleTime = Math.min(clip.duration,  Math.max(0, time));
        const numericValues: AnimatorSampledNumericValue[] = [];
        const objectReferences: AnimatorSampledObjectReference[] = [];

        for (const curve of clip.scalarCurves)
        {
            const value = this.sampleScalarCurve(curve, sampleTime);
            if (value === null)
                continue;

            numericValues.push({
                bindingIndex: curve.bindingIndex,
                componentIndex: curve.componentIndex,
                value
            });
        }

        for (const curve of clip.objectReferenceCurves)
        {
            const mappingIndex = this.sampleObjectReferenceCurve(curve, sampleTime);
            if (mappingIndex === null)
                continue;

            objectReferences.push({
                bindingIndex: curve.bindingIndex,
                mappingIndex
            });
        }

        return {
            clipId: clip.pathId,
            clipName: clip.name,
            time: sampleTime,
            numericValues,
            objectReferences
        };
    }

    validateAllClips() {
        for (const clip of this.manifest.clips)
            this.validateClipData(clip);
    }

    private sampleScalarCurve(curve: AnimatorScalarCurveDefinition, time: number): number | null {
        if (curve.keyCount === 0)
            return null;

        if (curve.keyCount === 1)
            return this.getKeyValue(curve.firstKey);

        const firstTime = this.getKeyTime(curve.firstKey);
        if (time <= firstTime)
            return this.getKeyValue(curve.firstKey);

        const lastKeyIndex = curve.firstKey + curve.keyCount - 1;
        const lastTime = this.getKeyTime(lastKeyIndex);

        if (time >= lastTime)
            return this.getKeyValue(lastKeyIndex);

        const rightKeyIndex = this.findFirstKeyAfter(curve.firstKey, curve.keyCount, time);
        const leftKeyIndex = rightKeyIndex - 1;
        const leftTime = this.getKeyTime(leftKeyIndex);
        const rightTime = this.getKeyTime(rightKeyIndex);
        const leftValue = this.getKeyValue(leftKeyIndex);
        const rightValue = this.getKeyValue(rightKeyIndex);
        const interval = rightTime - leftTime;

        if (interval <= 0)
            return rightValue;

        const flags = this.getKeyFlags(leftKeyIndex);

        if (flags === this.FLAG_CUBIC)
        {
            const elapsed = time - leftTime;
            const coefficient0 = this.getKeyFloat(leftKeyIndex, this.COEFFICIENT_0_OFFSET);
            const coefficient1 = this.getKeyFloat(leftKeyIndex, this.COEFFICIENT_1_OFFSET);
            const coefficient2 = this.getKeyFloat(leftKeyIndex, this.COEFFICIENT_2_OFFSET);
            const coefficient3 = this.getKeyFloat(leftKeyIndex, this.COEFFICIENT_3_OFFSET);

            return ((coefficient0 * elapsed + coefficient1) * elapsed + coefficient2) * elapsed + coefficient3;
        }

        const progress = (time - leftTime) / interval;

        return leftValue + (rightValue - leftValue) * progress;
    }

    private sampleObjectReferenceCurve(curve: AnimatorObjectReferenceCurveDefinition, time: number): number | null {
        if (curve.keys.length === 0)
            return null;

        if (time <= curve.keys[0].time)
            return curve.keys[0].mappingIndex;

        const lastKey = curve.keys[curve.keys.length - 1];
        if (time >= lastKey.time)
            return lastKey.mappingIndex;

        let low = 0;
        let high = curve.keys.length;

        while (low < high)
        {
            const middle = low + Math.floor((high - low) / 2);

            if (curve.keys[middle].time <= time)
                low = middle + 1;
            else
                high = middle;
        }

        return curve.keys[Math.max(0, low - 1)].mappingIndex;
    }

    private findFirstKeyAfter(firstKey: number, keyCount: number, time: number): number {
        let low = 0;
        let high = keyCount;

        while (low < high)
        {
            const middle = low + Math.floor((high - low) / 2);
            const keyTime = this.getKeyTime(firstKey + middle);

            if (keyTime <= time)
                low = middle + 1;
            else
                high = middle;
        }

        return firstKey + low;
    }

    private validateManifest() {
        if (this.manifest.file !== "animations.bin")
            throw new Error("The Animator animation file name is invalid.");
        if (this.manifest.magic !== this.MAGIC)
            throw new Error("The Animator animation magic value is invalid.");
        if (this.manifest.keyRecordStride !== this.KEY_RECORD_STRIDE)
            throw new Error("The Animator animation key stride is unsupported.");
        if (!Number.isInteger(this.manifest.keyCount) || this.manifest.keyCount < 0 || this.manifest.keyCount > this.MAXIMUM_KEY_COUNT)
            throw new Error("The Animator animation key count is invalid.");

        const expectedSize = this.HEADER_SIZE + this.manifest.keyCount * this.KEY_RECORD_STRIDE;
        if (!Number.isSafeInteger(expectedSize) || this.data.byteLength !== expectedSize)
            throw new Error("The Animator animation binary size is invalid.");
    }

    private validateBinaryHeader() {
        const expected = [
            0x4c, 0x4f, 0x52,
            0x41, 0x4e, 0x4d,
            0x31, 0x00
        ];

        for (let i = 0; i < expected.length; i++)
        {
            if (this.data.getUint8(i) !== expected[i])
                throw new Error("The Animator animation binary header is invalid.");
        }
    }

    private indexClips() {
        for (const clip of this.manifest.clips)
        {
            if (!clip.pathId)
                throw new Error("An Animator animation clip has no path ID.");
            if (this.clipsById.has(clip.pathId))
                throw new Error(`AnimationClip path ID "${clip.pathId}" is duplicated.`);
            if (!Number.isFinite(clip.duration) || clip.duration < 0)
                throw new Error(`AnimationClip "${clip.name}" has an invalid duration.`);

            this.clipsById.set(clip.pathId, clip);
        }
    }

    private validateCurveLayout() {
        let expectedFirstKey = 0;

        for (const clip of this.manifest.clips)
        {
            const bindings = this.indexBindings(clip);
            const scalarCurves = new Set<string>();
            const objectReferenceBindings = new Set<number>();

            for (const curve of clip.scalarCurves)
            {
                this.validateScalarCurveDefinition(clip, curve, bindings, scalarCurves);

                if (curve.firstKey !== expectedFirstKey)
                    throw new Error(`AnimationClip "${clip.name}" has a non-contiguous key range.`);

                expectedFirstKey += curve.keyCount;
            }

            for (const curve of clip.objectReferenceCurves)
            {
                if (!Number.isInteger(curve.bindingIndex) || objectReferenceBindings.has(curve.bindingIndex))
                    throw new Error(`AnimationClip "${clip.name}" has an invalid object-reference curve.`);

                const binding = bindings.get(curve.bindingIndex);
                if (!binding?.isPPtrCurve)
                    throw new Error(`AnimationClip "${clip.name}" has an object-reference curve for a numeric binding.`);

                objectReferenceBindings.add(curve.bindingIndex);
            }
        }

        if (expectedFirstKey !== this.manifest.keyCount)
            throw new Error("The Animator animation key ranges are incomplete.");
    }

    private indexBindings(clip: AnimatorSampleableClip): Map<number, AnimatorBindingDefinition> {
        const result = new Map<number, AnimatorBindingDefinition>();

        for (const binding of clip.bindings)
        {
            if (
                !Number.isInteger(binding.bindingIndex) ||
                result.has(binding.bindingIndex) ||
                !Number.isInteger(binding.scalarCount) ||
                binding.scalarCount < 0 ||
                binding.components.length !== binding.scalarCount
            )
            {
                throw new Error(`AnimationClip "${clip.name}" has an invalid binding table.`);
            }

            result.set(binding.bindingIndex, binding);
        }

        return result;
    }

    private validateScalarCurveDefinition(
        clip: AnimatorSampleableClip,
        curve: AnimatorScalarCurveDefinition,
        bindings: ReadonlyMap<number, AnimatorBindingDefinition>,
        existingCurves: Set<string>
    ) {
        if (curve.storage !== "streamed" &&  curve.storage !== "dense" && curve.storage !== "constant")
            throw new Error(`AnimationClip "${clip.name}" has an unknown curve storage type.`);

        if (
            !Number.isInteger(curve.bindingIndex) ||
            !Number.isInteger(curve.componentIndex) ||
            !Number.isInteger(curve.firstKey) ||
            !Number.isInteger(curve.keyCount) ||
            curve.componentIndex < 0 ||
            curve.firstKey < 0 ||
            curve.keyCount < 0
        )
        {
            throw new Error(`AnimationClip "${clip.name}" has an invalid scalar curve.`);
        }

        const binding = bindings.get(curve.bindingIndex);
        if (!binding || binding.isPPtrCurve || curve.componentIndex >= binding.scalarCount)
            throw new Error(`AnimationClip "${clip.name}" has a scalar curve for an invalid binding component.`);

        const identity = `${curve.bindingIndex}:${curve.componentIndex}`;
        if (existingCurves.has(identity))
            throw new Error(`AnimationClip "${clip.name}" contains a duplicated scalar curve.`);

        existingCurves.add(identity);
    }

    private validateClipData(clip: AnimatorSampleableClip) {
        if (this.validatedClips.has(clip))
            return;

        for (const curve of clip.scalarCurves)
            this.validateScalarCurveData(clip, curve);

        for (const curve of clip.objectReferenceCurves)
            this.validateObjectReferenceCurveData(clip, curve);

        this.validatedClips.add(clip);
    }

    private validateScalarCurveData(clip: AnimatorSampleableClip, curve: AnimatorScalarCurveDefinition) {
        let previousTime = Number.NEGATIVE_INFINITY;

        for (let offset = 0; offset < curve.keyCount; offset++)
        {
            const keyIndex = curve.firstKey + offset;
            const time = this.getKeyTime(keyIndex);
            const value = this.getKeyValue(keyIndex);
            const flags = this.getKeyFlags(keyIndex);

            if (!Number.isFinite(time) || time < previousTime)
                throw new Error( `AnimationClip "${clip.name}" has unordered or invalid key times.`);
            if (!Number.isFinite(value))
                throw new Error(`AnimationClip "${clip.name}" has a non-finite key value.`);
            if (flags !== this.FLAG_SAMPLED && flags !== this.FLAG_CUBIC)
                throw new Error(`AnimationClip "${clip.name}" has an unknown animation key type.`);
            if (curve.storage === "streamed" && flags !== this.FLAG_CUBIC)
                throw new Error(`AnimationClip "${clip.name}" has an invalid streamed key.`);
            if (curve.storage !== "streamed" && flags !== this.FLAG_SAMPLED)
                throw new Error(`AnimationClip "${clip.name}" has an invalid sampled key.`);

            if (flags === this.FLAG_CUBIC)
            {
                for (const coefficientOffset of [this.COEFFICIENT_0_OFFSET, this.COEFFICIENT_1_OFFSET, this.COEFFICIENT_2_OFFSET, this.COEFFICIENT_3_OFFSET])
                {
                    if (!Number.isFinite(this.getKeyFloat(keyIndex, coefficientOffset)))
                        throw new Error(`AnimationClip "${clip.name}" has a non-finite cubic coefficient.`);
                }
            }

            previousTime = time;
        }
    }

    private validateObjectReferenceCurveData(clip: AnimatorSampleableClip, curve: AnimatorObjectReferenceCurveDefinition) {
        let previousTime = Number.NEGATIVE_INFINITY;

        for (const key of curve.keys)
        {
            if (!Number.isFinite(key.time) || key.time < previousTime)
                throw new Error(`AnimationClip "${clip.name}" has unordered or invalid object-reference keys.`);

            if (!Number.isInteger(key.mappingIndex) || key.mappingIndex < -1 || key.mappingIndex >= clip.pptrCurveMapping.length)
                throw new Error(`AnimationClip "${clip.name}" has an invalid object-reference mapping index.`);

            previousTime = key.time;
        }
    }

    private getKeyTime(keyIndex: number): number {
        return this.getKeyFloat(keyIndex, this.TIME_OFFSET);
    }

    private getKeyValue(keyIndex: number): number {
        return this.getKeyFloat(keyIndex, this.VALUE_OFFSET);
    }

    private getKeyFlags(keyIndex: number): number {
        return this.data.getUint32(this.getKeyOffset(keyIndex) + this.FLAGS_OFFSET, true);
    }

    private getKeyFloat(keyIndex: number, fieldOffset: number): number {
        return this.data.getFloat32(this.getKeyOffset(keyIndex) + fieldOffset, true);
    }

    private getKeyOffset(keyIndex: number): number {
        if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= this.manifest.keyCount)
            throw new Error("An Animator animation key index is out of bounds.");

        return this.HEADER_SIZE + keyIndex * this.KEY_RECORD_STRIDE;
    }
}
