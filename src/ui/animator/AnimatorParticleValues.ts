import type { AnimatorRuntimeParticleValue } from "./AnimatorBindingResolver";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type AnimatorParticleColor = Readonly<{
    r: number;
    g: number;
    b: number;
    a: number;
}>;

export type AnimatorParticleCurveSample = Readonly<{
    evaluate(normalizedTime: number): number;
}>;

export type AnimatorParticleGradientSample = Readonly<{
    evaluate(normalizedTime: number): AnimatorParticleColor;
}>;

type TimelineKey = Readonly<{
    time: number;
}>;

type AnimatorParticleCurveKey = Readonly<{
    time: number;
    value: number;
    inSlope: number;
    outSlope: number;
}>;

type AnimatorParticleGradientColorKey = Readonly<{
    time: number;
    color: AnimatorParticleColor;
}>;

type AnimatorParticleGradientAlphaKey = Readonly<{
    time: number;
    alpha: number;
}>;

export const DEFAULT_ANIMATOR_PARTICLE_RANDOM_SEED = 0x6d2b79f5;
const MAXIMUM_CURVE_KEYS = 256;
const MAXIMUM_GRADIENT_KEYS = 8;
const GRADIENT_TIME_MAXIMUM = 65535;

export class AnimatorParticleRandom {
    private state: number;

    constructor(seed: number) {
        if (!Number.isFinite(seed))
            throw new Error("The particle random seed must be finite.");

        this.state = seed >>> 0;

        if (this.state === 0)
            this.state = DEFAULT_ANIMATOR_PARTICLE_RANDOM_SEED;
    }

    nextUint32(): number {
        let value = this.state;

        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;

        this.state = value >>> 0;
        return this.state;
    }

    nextFloat(): number {
        return this.nextUint32() / 0x100000000;
    }
}

export class AnimatorParticleMinMaxCurve {
    private constructor(
        private readonly mode: number,
        private readonly scalar: number,
        private readonly minimumScalar: number,
        private readonly minimumCurve: AnimatorParticleCurve,
        private readonly maximumCurve: AnimatorParticleCurve
    ) {}

    static parse(value: AnimatorRuntimeParticleValue, context: string): AnimatorParticleMinMaxCurve {
        const object = AnimatorRuntimeUtils.requireRecord(value, context);
        const mode = AnimatorRuntimeUtils.requireIntegerProperty(object, "minMaxState", context);

        if (mode < 0 || mode > 3)
            throw new Error(`${context} uses unsupported min/max curve mode ${mode}.`);

        const scalar = AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "scalar", context);
        const minimumScalar = AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "minScalar", context);

        const maximumCurve = AnimatorParticleCurve.parse(AnimatorRuntimeUtils.requireProperty(object, "maxCurve", context), `${context} maximum curve`);
        const minimumCurve = AnimatorParticleCurve.parse(AnimatorRuntimeUtils.requireProperty(object, "minCurve", context), `${context} minimum curve`);

        if ((mode === 1 || mode === 2) && maximumCurve.isEmpty)
            throw new Error(`${context} has no maximum curve keys.`);
        if (mode === 2 && minimumCurve.isEmpty)
            throw new Error(`${context} has no minimum curve keys.`);

        return new AnimatorParticleMinMaxCurve(mode, scalar, minimumScalar, minimumCurve, maximumCurve);
    }

    createSample(random: AnimatorParticleRandom): AnimatorParticleCurveSample {
        const randomFactor = this.mode === 2 || this.mode === 3
            ? random.nextFloat()
            : 0;

        return Object.freeze({
            evaluate: (normalizedTime: number) => this.evaluate(normalizedTime, randomFactor)
        });
    }

    evaluate(normalizedTime: number, randomFactor = 0): number {
        const time = requireFiniteArgument(normalizedTime, "Particle curve time");
        const factor = AnimatorRuntimeUtils.clamp01(randomFactor);

        switch (this.mode)
        {
            case 0:
                return this.scalar;
            case 1:
                return this.maximumCurve.evaluate(time) * this.scalar;
            case 2:
                return AnimatorRuntimeUtils.lerp(this.minimumCurve.evaluate(time), this.maximumCurve.evaluate(time), factor) * this.scalar;
            case 3:
                return AnimatorRuntimeUtils.lerp(this.minimumScalar, this.scalar, factor);
            default:
                throw new Error(`Unsupported particle curve mode ${this.mode}.`);
        }
    }
}

export class AnimatorParticleMinMaxGradient {
    private constructor(
        private readonly mode: number,
        private readonly minimumColor: AnimatorParticleColor,
        private readonly maximumColor: AnimatorParticleColor,
        private readonly minimumGradient: AnimatorParticleGradient,
        private readonly maximumGradient: AnimatorParticleGradient
    ) {}

    static parse(value: AnimatorRuntimeParticleValue, context: string): AnimatorParticleMinMaxGradient {
        const object = AnimatorRuntimeUtils.requireRecord(value, context);
        const mode = AnimatorRuntimeUtils.requireIntegerProperty(object, "minMaxState", context);

        if (mode < 0 || mode > 4)
            throw new Error(`${context} uses unsupported min/max gradient mode ${mode}.`);

        const minimumColor = parseColor(AnimatorRuntimeUtils.requireProperty(object, "minColor", context), `${context} minimum color`);
        const maximumColor = parseColor(AnimatorRuntimeUtils.requireProperty(object, "maxColor", context), `${context} maximum color`);
        const minimumGradient = AnimatorParticleGradient.parse(AnimatorRuntimeUtils.requireProperty(object, "minGradient", context), `${context} minimum gradient`);
        const maximumGradient = AnimatorParticleGradient.parse(AnimatorRuntimeUtils.requireProperty(object, "maxGradient", context), `${context} maximum gradient`);

        return new AnimatorParticleMinMaxGradient(mode, minimumColor, maximumColor, minimumGradient, maximumGradient);
    }

    createSample(random: AnimatorParticleRandom): AnimatorParticleGradientSample {
        const randomFactor = this.mode >= 2
            ? random.nextFloat()
            : 0;

        return Object.freeze({
            evaluate: (normalizedTime: number) => this.evaluate(normalizedTime, randomFactor)
        });
    }

    evaluate(normalizedTime: number, randomFactor = 0): AnimatorParticleColor {
        const time = AnimatorRuntimeUtils.clamp01(requireFiniteArgument(normalizedTime, "Particle gradient time"));
        const factor = AnimatorRuntimeUtils.clamp01(randomFactor);

        switch (this.mode)
        {
            case 0:
                return this.maximumColor;
            case 1:
                return this.maximumGradient.evaluate(time);
            case 2:
                return lerpColor(this.minimumColor, this.maximumColor, factor);
            case 3:
                return lerpColor(this.minimumGradient.evaluate(time), this.maximumGradient.evaluate(time), factor);
            case 4:
                return this.maximumGradient.evaluate(factor);
            default:
                throw new Error(`Unsupported particle gradient mode ${this.mode}.`);
        }
    }
}

class AnimatorParticleCurve {
    private constructor(private readonly keys: readonly AnimatorParticleCurveKey[]) {}

    get isEmpty(): boolean {
        return this.keys.length === 0;
    }

    static parse(value: unknown, context: string): AnimatorParticleCurve {
        const object = AnimatorRuntimeUtils.requireRecord(value, context);
        const rawKeys = AnimatorRuntimeUtils.requireArrayProperty(object, "m_Curve", context);

        if (rawKeys.length > MAXIMUM_CURVE_KEYS)
            throw new Error(`${context} exceeds the ${MAXIMUM_CURVE_KEYS}-key limit.`);

        const preInfinity = AnimatorRuntimeUtils.requireIntegerProperty(object, "m_PreInfinity", context);
        const postInfinity = AnimatorRuntimeUtils.requireIntegerProperty(object, "m_PostInfinity", context);

        if (preInfinity !== 2 || postInfinity !== 2)
            throw new Error(`${context} uses unsupported curve extrapolation.`);

        const keys = rawKeys.map((rawKey, index) => {
            const keyContext = `${context} key ${index}`;
            const key = AnimatorRuntimeUtils.requireRecord(rawKey, keyContext);
            const weightedMode = AnimatorRuntimeUtils.requireIntegerProperty(key, "weightedMode", keyContext);

            if (weightedMode !== 0)
                throw new Error(`${keyContext} uses unsupported weighted tangents.`);

            return Object.freeze({
                time: AnimatorRuntimeUtils.requireFiniteNumberProperty(key, "time", keyContext),
                value: AnimatorRuntimeUtils.requireFiniteNumberProperty(key, "value", keyContext),
                inSlope: AnimatorRuntimeUtils.requireFiniteNumberProperty(key, "inSlope", keyContext),
                outSlope: AnimatorRuntimeUtils.requireFiniteNumberProperty(key, "outSlope", keyContext)
            });
        });

        for (let i = 1; i < keys.length; i++)
        {
            if (keys[i].time < keys[i - 1].time)
                throw new Error(`${context} keys are not ordered by time.`);
        }

        return new AnimatorParticleCurve(Object.freeze(keys));
    }

    evaluate(time: number): number {
        if (this.keys.length === 0)
            return 0;

        const first = this.keys[0];
        const last = this.keys[this.keys.length - 1];

        if (time <= first.time)
            return first.value;

        if (time >= last.time)
            return last.value;

        for (let i = 0; i < this.keys.length - 1; i++)
        {
            const left = this.keys[i];
            const right = this.keys[i + 1];

            if (time > right.time)
                continue;

            const duration = right.time - left.time;

            if (duration <= 0)
                return right.value;

            const normalized = (time - left.time) / duration;
            const squared = normalized * normalized;
            const cubed = squared * normalized;

            const h00 = (2 * cubed) - (3 * squared) + 1;
            const h10 = cubed - (2 * squared) + normalized;
            const h01 = (-2 * cubed) + (3 * squared);
            const h11 = cubed - squared;

            return (
                (h00 * left.value) +
                (h10 * left.outSlope * duration) +
                (h01 * right.value) +
                (h11 * right.inSlope * duration)
            );
        }

        return last.value;
    }
}

class AnimatorParticleGradient {
    private constructor(
        private readonly mode: number,
        private readonly colorKeys: readonly AnimatorParticleGradientColorKey[],
        private readonly alphaKeys: readonly AnimatorParticleGradientAlphaKey[]
    ) {}

    static parse(value: unknown, context: string): AnimatorParticleGradient {
        const object = AnimatorRuntimeUtils.requireRecord(value, context);
        const mode = AnimatorRuntimeUtils.requireIntegerProperty(object, "m_Mode", context);

        if (mode !== 0 && mode !== 1)
            throw new Error(`${context} uses unsupported gradient mode ${mode}.`);

        const colorKeyCount = AnimatorRuntimeUtils.requireIntegerProperty(object, "m_NumColorKeys", context);
        const alphaKeyCount = AnimatorRuntimeUtils.requireIntegerProperty(object, "m_NumAlphaKeys", context);

        validateGradientKeyCount(colorKeyCount, `${context} color`);
        validateGradientKeyCount(alphaKeyCount, `${context} alpha`);

        const colors: AnimatorParticleColor[] = [];

        for (let i = 0; i < MAXIMUM_GRADIENT_KEYS; i++)
            colors.push(parseColor(AnimatorRuntimeUtils.requireProperty(object, `key${i}`, context), `${context} key ${i}`));

        const colorKeys: AnimatorParticleGradientColorKey[] = [];

        for (let i = 0; i < colorKeyCount; i++)
        {
            colorKeys.push(Object.freeze({
                time: parseGradientTime(AnimatorRuntimeUtils.requireIntegerProperty(object, `ctime${i}`, context), `${context} color key ${i}`),
                color: colors[i]
            }));
        }

        const alphaKeys: AnimatorParticleGradientAlphaKey[] = [];

        for (let i = 0; i < alphaKeyCount; i++)
        {
            alphaKeys.push(Object.freeze({
                time: parseGradientTime(AnimatorRuntimeUtils.requireIntegerProperty(object, `atime${i}`, context), `${context} alpha key ${i}`),
                alpha: colors[i].a
            }));
        }

        validateOrderedTimes(colorKeys, `${context} color`);
        validateOrderedTimes(alphaKeys, `${context} alpha`);

        return new AnimatorParticleGradient(mode, Object.freeze(colorKeys), Object.freeze(alphaKeys));
    }

    evaluate(time: number): AnimatorParticleColor {
        const color = evaluateColorKeys(this.colorKeys, time, this.mode);
        const alpha = evaluateAlphaKeys(this.alphaKeys, time, this.mode);

        return Object.freeze({
            r: color.r,
            g: color.g,
            b: color.b,
            a: alpha
        });
    }
}

function evaluateColorKeys(keys: readonly AnimatorParticleGradientColorKey[], time: number, mode: number): AnimatorParticleColor {
    const index = findTimelineSegment(keys, time);
    if (index >= keys.length - 1)
        return keys[keys.length - 1].color;

    const left = keys[index];
    const right = keys[index + 1];

    if (mode === 1)
        return time >= right.time ? right.color : left.color;

    const duration = right.time - left.time;
    const factor = duration > 0
        ? AnimatorRuntimeUtils.clamp01((time - left.time) / duration)
        : 1;

    return lerpColor(left.color, right.color, factor);
}

function evaluateAlphaKeys(keys: readonly AnimatorParticleGradientAlphaKey[], time: number, mode: number): number {
    const index = findTimelineSegment(keys, time);
    if (index >= keys.length - 1)
        return keys[keys.length - 1].alpha;

    const left = keys[index];
    const right = keys[index + 1];

    if (mode === 1)
        return time >= right.time ? right.alpha : left.alpha;

    const duration = right.time - left.time;
    const factor = duration > 0
        ? AnimatorRuntimeUtils.clamp01((time - left.time) / duration)
        : 1;

    return AnimatorRuntimeUtils.lerp(left.alpha, right.alpha, factor);
}

function findTimelineSegment<T extends TimelineKey>(keys: readonly T[], time: number): number {
    if (time <= keys[0].time)
        return 0;

    for (let i = 0; i < keys.length - 1; i++)
    {
        if (time <= keys[i + 1].time)
            return i;
    }

    return keys.length - 1;
}

function parseColor(value: unknown, context: string): AnimatorParticleColor {
    const object = AnimatorRuntimeUtils.requireRecord(value, context);

    return Object.freeze({
        r: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "r", context),
        g: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "g", context),
        b: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "b", context),
        a: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "a", context)
    });
}

function parseGradientTime(value: number, context: string): number {
    if (value < 0 || value > GRADIENT_TIME_MAXIMUM)
        throw new Error(`${context} has an invalid normalized time.`);

    return value / GRADIENT_TIME_MAXIMUM;
}

function validateGradientKeyCount(count: number, context: string) {
    if (count < 1 || count > MAXIMUM_GRADIENT_KEYS)
        throw new Error(`${context} gradient has an invalid number of keys.`);
}

function validateOrderedTimes<T extends TimelineKey>(keys: readonly T[], context: string) {
    for (let i = 1; i < keys.length; i++)
    {
        if (keys[i].time < keys[i - 1].time)
            throw new Error(`${context} gradient keys are not ordered.`);
    }
}

function lerpColor(left: AnimatorParticleColor, right: AnimatorParticleColor, factor: number): AnimatorParticleColor {
    return Object.freeze({
        r: AnimatorRuntimeUtils.lerp(left.r, right.r, factor),
        g: AnimatorRuntimeUtils.lerp(left.g, right.g, factor),
        b: AnimatorRuntimeUtils.lerp(left.b, right.b, factor),
        a: AnimatorRuntimeUtils.lerp(left.a, right.a, factor)
    });
}

function requireFiniteArgument(value: number, context: string): number {
    if (!Number.isFinite(value))
        throw new Error(`${context} must be finite.`);

    return value;
}
