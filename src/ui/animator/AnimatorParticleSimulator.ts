import type { AnimatorParticleColor, AnimatorParticleCurveSample, AnimatorParticleGradientSample } from "./AnimatorParticleValues";
import type { AnimatorRuntimeParticleSystem, AnimatorRuntimeParticleValue } from "./AnimatorBindingResolver";

import { AnimatorParticleMinMaxCurve, AnimatorParticleMinMaxGradient, AnimatorParticleRandom, DEFAULT_ANIMATOR_PARTICLE_RANDOM_SEED } from "./AnimatorParticleValues";
import { AnimatorRuntimeUtils, type AnimatorRuntimeRecord } from "./AnimatorRuntimeUtils";

export type AnimatorParticleVector3 = Readonly<{
    x: number;
    y: number;
    z: number;
}>;

export type AnimatorParticleSnapshot = Readonly<{
    id: number;
    randomSeed: number;
    age: number;
    lifetime: number;
    normalizedAge: number;
    position: AnimatorParticleVector3;
    velocity: AnimatorParticleVector3;
    rotation: AnimatorParticleVector3;
    initialSize: number;
    size: number;
    initialColor: AnimatorParticleColor;
    color: AnimatorParticleColor;
    textureFrame: number;
}>;

type RotationOverLifetimeModule = Readonly<{
    x: AnimatorParticleMinMaxCurve | null;
    y: AnimatorParticleMinMaxCurve | null;
    z: AnimatorParticleMinMaxCurve;
}>;

type RotationOverLifetimeSamples = Readonly<{
    x: AnimatorParticleCurveSample | null;
    y: AnimatorParticleCurveSample | null;
    z: AnimatorParticleCurveSample;
}>;

type VelocityLimitModule = Readonly<{
    magnitude: AnimatorParticleMinMaxCurve;
    drag: AnimatorParticleMinMaxCurve;
    dampen: number;
    multiplyDragByParticleSize: boolean;
    multiplyDragByParticleVelocity: boolean;
}>;

type VelocityLimitSamples = Readonly<{
    magnitude: AnimatorParticleCurveSample;
    drag: AnimatorParticleCurveSample;
}>;

type NoiseModule = Readonly<{
    strength: AnimatorParticleMinMaxCurve;
    scrollSpeed: AnimatorParticleMinMaxCurve;
    positionAmount: AnimatorParticleMinMaxCurve;
    frequency: number;
    damping: boolean;
}>;

type NoiseSamples = Readonly<{
    strength: AnimatorParticleCurveSample;
    scrollSpeed: AnimatorParticleCurveSample;
    positionAmount: AnimatorParticleCurveSample;
}>;

type MutableVector3 = {
    x: number;
    y: number;
    z: number;
};

type MutableParticle = {
    id: number;
    randomSeed: number;
    age: number;
    lifetime: number;
    position: MutableVector3;
    velocity: MutableVector3;
    velocityLimit: VelocityLimitSamples | null;
    rotation: MutableVector3;
    initialSize: number;
    size: number;
    initialColor: AnimatorParticleColor;
    color: AnimatorParticleColor;
    gravity: AnimatorParticleCurveSample;
    noise: NoiseSamples | null;
    sizeOverLifetime: AnimatorParticleCurveSample | null;
    rotationOverLifetime: RotationOverLifetimeSamples | null;
    colorOverLifetime: AnimatorParticleGradientSample | null;
    textureFrame: number;
    textureFrameOverLifetime: AnimatorParticleCurveSample | null;
    textureStartFrame: AnimatorParticleCurveSample | null;
};

type ParticleObject = AnimatorRuntimeRecord<AnimatorRuntimeParticleValue>;

type InitialModule = Readonly<{
    lifetime: AnimatorParticleMinMaxCurve;
    speed: AnimatorParticleMinMaxCurve;
    size: AnimatorParticleMinMaxCurve;
    rotationX: AnimatorParticleMinMaxCurve | null;
    rotationY: AnimatorParticleMinMaxCurve | null;
    rotationZ: AnimatorParticleMinMaxCurve;
    color: AnimatorParticleMinMaxGradient;
    gravity: AnimatorParticleMinMaxCurve;
    randomizeRotationDirection: number;
    maximumParticleCount: number;
}>;

type EmissionBurst = Readonly<{
    time: number;
    count: AnimatorParticleMinMaxCurve;
    cycleCount: number;
    repeatInterval: number;
    probability: number;
}>;

type EmissionModule = Readonly<{
    enabled: boolean;
    rateOverTime: AnimatorParticleMinMaxCurve;
    rateOverDistance: AnimatorParticleMinMaxCurve;
    bursts: readonly EmissionBurst[];
}>;

type ConeShapeModule = Readonly<{
    enabled: boolean;
    radius: number;
    radiusThickness: number;
    arcRadians: number;
    angleRadians: number;
    position: AnimatorParticleVector3;
    rotation: AnimatorParticleVector3;
    scale: AnimatorParticleVector3;
}>;

export type AnimatorParticleTextureSheet = Readonly<{
    columns: number;
    rows: number;
}>;

type TextureSheetModule = Readonly<{
    columns: number;
    rows: number;
    cycles: number;
    frameOverLifetime: AnimatorParticleMinMaxCurve;
    startFrame: AnimatorParticleMinMaxCurve;
}>;

export class AnimatorParticleSimulator {
    private readonly MAXIMUM_PARTICLE_COUNT = 100_000;
    private readonly MAXIMUM_BURSTS = 1_024;
    private readonly MAXIMUM_ADVANCE_SECONDS = 0.25;
    private readonly MAXIMUM_STEP_SECONDS = 1 / 60;
    private readonly EPSILON = 1e-8;
    private readonly gravityAcceleration: MutableVector3 = { x: 0, y: -9.81, z: 0 };
    private readonly initialModule: InitialModule;
    private readonly emissionModule: EmissionModule;
    private readonly shapeModule: ConeShapeModule;
    private readonly textureSheetModule: TextureSheetModule | null;
    private readonly velocityLimitModule: VelocityLimitModule | null;
    private readonly noiseModule: NoiseModule | null;
    private readonly noiseSeed: number;
    private readonly startDelay: AnimatorParticleMinMaxCurve;
    private readonly sizeOverLifetime: AnimatorParticleMinMaxCurve | null;
    private readonly rotationOverLifetime: RotationOverLifetimeModule | null;
    private readonly colorOverLifetime: AnimatorParticleMinMaxGradient | null;
    private readonly particles: MutableParticle[] = [];
    private random!: AnimatorParticleRandom;
    private rateOverTimeSample!: AnimatorParticleCurveSample;
    private nextParticleId = 1;
    private delayRemaining = 0;
    private cycleTime = 0;
    private emissionRemainder = 0;
    private simulationTime = 0;
    private playing = false;

    constructor(readonly definition: AnimatorRuntimeParticleSystem) {
        this.validateSystem(definition);

        this.startDelay = AnimatorParticleMinMaxCurve.parse(definition.startDelay, `ParticleSystem "${definition.id}" start delay`);
        this.initialModule = this.parseInitialModule(definition);
        this.emissionModule = this.parseEmissionModule(definition);
        this.shapeModule = this.parseShapeModule(definition);
        this.sizeOverLifetime = this.parseSizeOverLifetimeModule(definition);
        this.rotationOverLifetime = this.parseRotationOverLifetimeModule(definition);
        this.velocityLimitModule = this.parseVelocityLimitModule(definition);
        this.noiseModule = this.parseNoiseModule(definition);
        this.noiseSeed = (this.createRandomSeed() ^ 0x9e3779b9) >>> 0;
        this.colorOverLifetime = this.parseColorOverLifetimeModule(definition);
        this.textureSheetModule = this.parseTextureSheetModule(definition);

        this.reset();
    }

    get particleSystemId(): string {
        return this.definition.id;
    }

    get gameObjectId(): string {
        return this.definition.gameObjectId;
    }

    get isPlaying(): boolean {
        return this.playing;
    }

    get particleCount(): number {
        return this.particles.length;
    }

    get textureSheet(): AnimatorParticleTextureSheet {
        return Object.freeze({
            columns: this.textureSheetModule?.columns ?? 1,
            rows: this.textureSheetModule?.rows ?? 1
        });
    }

    getParticles(): readonly AnimatorParticleSnapshot[] {
        return this.particles.map((particle) => Object.freeze({
            id: particle.id,
            randomSeed: particle.randomSeed,
            age: particle.age,
            lifetime: particle.lifetime,
            normalizedAge: AnimatorRuntimeUtils.clamp01(particle.age / particle.lifetime),
            position: Object.freeze({ ...particle.position }),
            velocity: Object.freeze({ ...particle.velocity }),
            rotation: Object.freeze({ ...particle.rotation }),
            initialSize: particle.initialSize,
            size: particle.size,
            initialColor: particle.initialColor,
            color: particle.color,
            textureFrame: particle.textureFrame
        }));
    }

    reset() {
        this.random = new AnimatorParticleRandom(this.createRandomSeed());
        this.particles.length = 0;
        this.nextParticleId = 1;
        this.cycleTime = 0;
        this.emissionRemainder = 0;
        this.simulationTime = 0;

        this.rateOverTimeSample = this.emissionModule.rateOverTime.createSample(this.random);
        this.delayRemaining = Math.max(0, this.startDelay.createSample(this.random).evaluate(0));
        this.playing = this.definition.playOnAwake;

        if (this.playing && this.delayRemaining <= this.EPSILON)
            this.emitBurstsAtTime(0);
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    stop(clearParticles = true) {
        this.playing = false;
        this.cycleTime = 0;
        this.emissionRemainder = 0;

        if (clearParticles)
            this.particles.length = 0;
    }

    advance(deltaSeconds: number) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Particle simulation delta must be finite and non-negative.");

        let remaining = Math.min(deltaSeconds, this.MAXIMUM_ADVANCE_SECONDS) * this.definition.simulationSpeed;

        while (remaining > this.EPSILON)
        {
            const step = Math.min(remaining, this.MAXIMUM_STEP_SECONDS);

            this.updateParticles(step);

            if (this.playing)
                this.advancePlayback(step);

            this.simulationTime += step;
            remaining -= step;
        }
    }

    setLocalGravityAcceleration(acceleration: AnimatorParticleVector3) {
        if (!Number.isFinite(acceleration.x) || !Number.isFinite(acceleration.y) || !Number.isFinite(acceleration.z))
            throw new Error("Particle gravity acceleration must be finite.");

        this.gravityAcceleration.x = acceleration.x;
        this.gravityAcceleration.y = acceleration.y;
        this.gravityAcceleration.z = acceleration.z;
    }

    private updateParticles(deltaSeconds: number) {
        for (let index = this.particles.length - 1; index >= 0; index--)
        {
            const particle = this.particles[index];

            particle.age += deltaSeconds;

            if (particle.age >= particle.lifetime)
            {
                this.particles.splice(index, 1);
                continue;
            }

            const normalizedAge = AnimatorRuntimeUtils.clamp01(particle.age / particle.lifetime);
            this.updateTextureFrame(particle, normalizedAge);

            if (particle.sizeOverLifetime)
                particle.size = particle.initialSize * Math.max(0, particle.sizeOverLifetime.evaluate(normalizedAge));

            if (particle.rotationOverLifetime)
            {
                particle.rotation.x += (particle.rotationOverLifetime.x?.evaluate(normalizedAge) ?? 0) * deltaSeconds;
                particle.rotation.y += (particle.rotationOverLifetime.y?.evaluate(normalizedAge) ?? 0) * deltaSeconds;
                particle.rotation.z += particle.rotationOverLifetime.z.evaluate(normalizedAge) * deltaSeconds;
            }

            if (particle.colorOverLifetime)
                particle.color = this.multiplyColors(particle.initialColor, particle.colorOverLifetime.evaluate(normalizedAge));

            const gravityModifier = particle.gravity.evaluate(normalizedAge);

            particle.velocity.x += this.gravityAcceleration.x * gravityModifier * deltaSeconds;
            particle.velocity.y += this.gravityAcceleration.y * gravityModifier * deltaSeconds;
            particle.velocity.z += this.gravityAcceleration.z * gravityModifier * deltaSeconds;
            this.applyVelocityLimit(particle, normalizedAge, deltaSeconds);

            const noiseVelocity = this.sampleNoiseVelocity(particle, normalizedAge);

            particle.position.x += (particle.velocity.x + noiseVelocity.x) * deltaSeconds;
            particle.position.y += (particle.velocity.y + noiseVelocity.y) * deltaSeconds;
            particle.position.z += (particle.velocity.z + noiseVelocity.z) * deltaSeconds;
        }
    }

    private advancePlayback(deltaSeconds: number) {
        let remaining = deltaSeconds;

        if (this.delayRemaining > this.EPSILON)
        {
            const consumed = Math.min(remaining, this.delayRemaining);

            this.delayRemaining -= consumed;
            remaining -= consumed;

            if (this.delayRemaining > this.EPSILON)
                return;

            this.emitBurstsAtTime(0);
        }

        while (remaining > this.EPSILON && this.playing)
        {
            const untilCycleEnd = this.definition.length - this.cycleTime;
            const segmentDuration = Math.min(remaining, untilCycleEnd);
            const segmentEnd = this.cycleTime + segmentDuration;

            this.emitContinuous(this.cycleTime, segmentEnd);
            this.emitBurstsInInterval(this.cycleTime, segmentEnd);

            this.cycleTime = segmentEnd;
            remaining -= segmentDuration;

            if (this.cycleTime < this.definition.length - this.EPSILON)
                continue;

            if (!this.definition.looping)
            {
                this.playing = false;
                break;
            }

            this.beginNextCycle();
        }
    }

    private beginNextCycle() {
        this.cycleTime = 0;
        this.emissionRemainder = 0;
        this.rateOverTimeSample = this.emissionModule.rateOverTime.createSample(this.random);

        this.emitBurstsAtTime(0);
    }

    private emitContinuous(startTime: number, endTime: number) {
        if (!this.emissionModule.enabled)
            return;

        const duration = endTime - startTime;
        if (duration <= this.EPSILON)
            return;

        const midpoint = ((startTime + endTime) * 0.5) / this.definition.length;
        const emissionRate = Math.max(0, this.rateOverTimeSample.evaluate(midpoint));
        const pending = this.emissionRemainder + (emissionRate * duration);
        const count = Math.floor(pending);

        this.emissionRemainder = pending - count;
        this.emitParticles(count);
    }

    private emitBurstsAtTime(time: number) {
        if (!this.emissionModule.enabled)
            return;

        for (const burst of this.emissionModule.bursts)
        {
            for (let cycle = 0; cycle < burst.cycleCount; cycle++)
            {
                const occurrence = burst.time + (cycle * burst.repeatInterval);

                if (Math.abs(occurrence - time) <= this.EPSILON)
                    this.emitBurst(burst, occurrence);
            }
        }
    }

    private emitBurstsInInterval(startTime: number, endTime: number) {
        if (!this.emissionModule.enabled)
            return;

        for (const burst of this.emissionModule.bursts)
        {
            for (let cycle = 0; cycle < burst.cycleCount; cycle++)
            {
                const occurrence = burst.time + (cycle * burst.repeatInterval);
                if (occurrence <= startTime + this.EPSILON || occurrence > endTime + this.EPSILON)
                    continue;

                this.emitBurst(burst, occurrence);
            }
        }
    }

    private emitBurst(burst: EmissionBurst, occurrenceTime: number) {
        if (this.random.nextFloat() > burst.probability)
            return;

        const normalizedTime = AnimatorRuntimeUtils.clamp01(occurrenceTime / this.definition.length);
        const count = Math.max(0, Math.round(burst.count.createSample(this.random).evaluate(normalizedTime)));

        this.emitParticles(count);
    }

    private emitParticles(count: number) {
        const available = this.initialModule.maximumParticleCount - this.particles.length;
        const emissionCount = Math.min(Math.max(0, count), available);

        for (let i = 0; i < emissionCount; i++)
            this.emitParticle();
    }

    private emitParticle() {
        const randomSeed = this.random.nextUint32();
        const random = new AnimatorParticleRandom(randomSeed);
        const lifetime = this.initialModule.lifetime.createSample(random).evaluate(0);

        if (!Number.isFinite(lifetime) || lifetime <= this.EPSILON)
            return;

        const speed = this.initialModule.speed.createSample(random).evaluate(0);
        const initialSize = Math.max(0, this.initialModule.size.createSample(random).evaluate(0));

        const rotation = {
            x: this.initialModule.rotationX?.createSample(random).evaluate(0) ?? 0,
            y: this.initialModule.rotationY?.createSample(random).evaluate(0) ?? 0,
            z: this.initialModule.rotationZ.createSample(random).evaluate(0)
        };

        if (random.nextFloat() < this.initialModule.randomizeRotationDirection)
            rotation.z *= -1;

        const initialColor = this.initialModule.color.createSample(random).evaluate(0);
        const shape = this.sampleShape(random);

        const particle: MutableParticle = {
            id: this.nextParticleId++,
            randomSeed,
            age: 0,
            lifetime,
            position: shape.position,
            velocity: {
                x: shape.direction.x * speed,
                y: shape.direction.y * speed,
                z: shape.direction.z * speed
            },
            velocityLimit: this.velocityLimitModule
                ? Object.freeze({
                    magnitude: this.velocityLimitModule.magnitude.createSample(random),
                    drag: this.velocityLimitModule.drag.createSample(random)
                })
                : null,
            rotation,
            initialSize,
            size: initialSize,
            initialColor,
            color: initialColor,
            gravity: this.initialModule.gravity.createSample(random),
            noise: this.noiseModule
                ? Object.freeze({
                    strength: this.noiseModule.strength.createSample(random),
                    scrollSpeed: this.noiseModule.scrollSpeed.createSample(random),
                    positionAmount: this.noiseModule.positionAmount.createSample(random)
                })
                : null,
            sizeOverLifetime: this.sizeOverLifetime?.createSample(random) ?? null,
            rotationOverLifetime: this.rotationOverLifetime
                ? Object.freeze({
                    x: this.rotationOverLifetime.x?.createSample(random) ?? null,
                    y: this.rotationOverLifetime.y?.createSample(random) ?? null,
                    z: this.rotationOverLifetime.z.createSample(random)
                })
                : null,
            colorOverLifetime: this.colorOverLifetime?.createSample(random) ?? null,
            textureFrame: 0,
            textureFrameOverLifetime: this.textureSheetModule?.frameOverLifetime.createSample(random) ?? null,
            textureStartFrame: this.textureSheetModule?.startFrame.createSample(random) ?? null
        };

        this.updateTextureFrame(particle, 0);
        this.particles.push(particle);
    }

    private sampleShape(random: AnimatorParticleRandom): Readonly<{ position: MutableVector3; direction: MutableVector3; }> {
        if (!this.shapeModule.enabled)
        {
            return {
                position: { x: 0, y: 0, z: 0 },
                direction: { x: 0, y: 0, z: 1 }
            };
        }

        const azimuth = random.nextFloat() * this.shapeModule.arcRadians;
        const minimumRadius = this.shapeModule.radius * (1 - this.shapeModule.radiusThickness);

        const radius = Math.sqrt(
            AnimatorRuntimeUtils.lerp(
                minimumRadius * minimumRadius,
                this.shapeModule.radius * this.shapeModule.radius,
                random.nextFloat()
            )
        );

        const cosine = Math.cos(azimuth);
        const sine = Math.sin(azimuth);

        const position = this.rotateEulerDegrees(
            {
                x: cosine * radius * this.shapeModule.scale.x,
                y: sine * radius * this.shapeModule.scale.y,
                z: 0
            },
            this.shapeModule.rotation
        );

        position.x += this.shapeModule.position.x;
        position.y += this.shapeModule.position.y;
        position.z += this.shapeModule.position.z;

        const radialFraction = this.shapeModule.radius > this.EPSILON
            ? radius / this.shapeModule.radius
            : 0;

        const coneSine = Math.sin(this.shapeModule.angleRadians) * radialFraction;

        const direction = this.normalizeVector(
            this.rotateEulerDegrees(
                {
                    x: cosine * coneSine,
                    y: sine * coneSine,
                    z: Math.cos(this.shapeModule.angleRadians)
                },
                this.shapeModule.rotation
            )
        );

        return { position, direction };
    }

    private parseInitialModule(definition: AnimatorRuntimeParticleSystem): InitialModule {
        const context = `ParticleSystem "${definition.id}" InitialModule`;
        const module = this.requireModule(definition, "InitialModule");

        if (!this.requireBoolean(module, "enabled", context))
            throw new Error(`${context} must be enabled.`);
        if (this.requireBoolean(module, "size3D", context))
            throw new Error(`${context} uses unsupported three-axis start size.`);

        const gravitySource = AnimatorRuntimeUtils.requireIntegerProperty(module, "gravitySource", context);
        if (gravitySource !== 0)
            throw new Error(`${context} uses an unsupported gravity source.`);

        const maximumParticleCount = AnimatorRuntimeUtils.requireIntegerProperty(module, "maxNumParticles", context);
        if (maximumParticleCount < 0 || maximumParticleCount > this.MAXIMUM_PARTICLE_COUNT)
            throw new Error(`${context} has an invalid maximum particle count.`);

        const randomizeRotationDirection = AnimatorRuntimeUtils.requireFiniteNumberProperty(module, "randomizeRotationDirection", context);
        if (randomizeRotationDirection < 0 || randomizeRotationDirection > 1)
            throw new Error(`${context} has an invalid rotation-direction probability.`);

        const rotation3D = this.requireBoolean(module, "rotation3D", context);

        return Object.freeze({
            lifetime: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startLifetime", context), `${context} start lifetime`),
            speed: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startSpeed", context), `${context} start speed`),
            size: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startSize", context), `${context} start size`),
            rotationX: rotation3D
                ? AnimatorParticleMinMaxCurve.parse(
                    AnimatorRuntimeUtils.requireProperty(module, "startRotationX", context),
                    `${context} start X rotation`
                )
                : null,
            rotationY: rotation3D
                ? AnimatorParticleMinMaxCurve.parse(
                    AnimatorRuntimeUtils.requireProperty(module, "startRotationY", context),
                    `${context} start Y rotation`
                )
                : null,
            rotationZ: AnimatorParticleMinMaxCurve.parse(
                AnimatorRuntimeUtils.requireProperty(module, "startRotation", context),
                `${context} start Z rotation`
            ),
            color: AnimatorParticleMinMaxGradient.parse(AnimatorRuntimeUtils.requireProperty(module, "startColor", context), `${context} start color`),
            gravity: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "gravityModifier", context), `${context} gravity modifier`),
            randomizeRotationDirection,
            maximumParticleCount
        });
    }

    private parseEmissionModule(definition: AnimatorRuntimeParticleSystem): EmissionModule {
        const context = `ParticleSystem "${definition.id}" EmissionModule`;
        const module = this.requireModule(definition, "EmissionModule");
        const enabled = this.requireBoolean(module, "enabled", context);
        const rateOverTime = AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "rateOverTime", context), `${context} rate over time`);
        const rateOverDistance = AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "rateOverDistance", context), `${context} rate over distance`);

        if (
            Math.abs(rateOverDistance.evaluate(0, 0)) > this.EPSILON ||
            Math.abs(rateOverDistance.evaluate(0.5, 0.5)) > this.EPSILON ||
            Math.abs(rateOverDistance.evaluate(1, 1)) > this.EPSILON
        )
        {
            throw new Error(`${context} uses unsupported distance-based emission.`);
        }

        const burstCount = AnimatorRuntimeUtils.requireIntegerProperty(module, "m_BurstCount", context);
        const rawBursts = AnimatorRuntimeUtils.requireArrayProperty(module, "m_Bursts", context);

        if (burstCount !== rawBursts.length || burstCount < 0 || burstCount > this.MAXIMUM_BURSTS)
            throw new Error(`${context} has invalid burst metadata.`);

        const bursts = rawBursts.map((rawBurst, index) => {
            const burstContext = `${context} burst ${index}`;
            const burst = AnimatorRuntimeUtils.requireRecord(rawBurst, burstContext);
            const time = AnimatorRuntimeUtils.requireFiniteNumberProperty(burst, "time", burstContext);
            const cycleCount = AnimatorRuntimeUtils.requireIntegerProperty(burst, "cycleCount", burstContext);
            const repeatInterval = AnimatorRuntimeUtils.requireFiniteNumberProperty(burst, "repeatInterval", burstContext);
            const probability = AnimatorRuntimeUtils.requireFiniteNumberProperty(burst, "probability", burstContext);

            if (time < 0 || time > definition.length)
                throw new Error(`${burstContext} occurs outside the system duration.`);
            if (cycleCount < 1 || cycleCount > this.MAXIMUM_BURSTS)
                throw new Error(`${burstContext} has an invalid cycle count.`);
            if (cycleCount > 1 && repeatInterval <= 0)
                throw new Error(`${burstContext} has an invalid repeat interval.`);
            if (probability < 0 || probability > 1)
                throw new Error(`${burstContext} has an invalid probability.`);

            return Object.freeze({
                time,
                count: AnimatorParticleMinMaxCurve.parse(
                    AnimatorRuntimeUtils.requireProperty(burst, "countCurve", burstContext) as AnimatorRuntimeParticleValue,
                    `${burstContext} count`
                ),
                cycleCount,
                repeatInterval,
                probability
            });
        });

        return Object.freeze({
            enabled,
            rateOverTime,
            rateOverDistance,
            bursts: Object.freeze(bursts)
        });
    }

    private parseShapeModule(definition: AnimatorRuntimeParticleSystem): ConeShapeModule {
        const context = `ParticleSystem "${definition.id}" ShapeModule`;
        const module = this.requireModule(definition, "ShapeModule");
        const enabled = this.requireBoolean(module, "enabled", context);

        if (!enabled)
        {
            return Object.freeze({
                enabled: false,
                radius: 0,
                radiusThickness: 0,
                arcRadians: 0,
                angleRadians: 0,
                position: Object.freeze({ x: 0, y: 0, z: 0 }),
                rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
                scale: Object.freeze({ x: 1, y: 1, z: 1 })
            });
        }

        const type = AnimatorRuntimeUtils.requireIntegerProperty(module, "type", context);
        if (type !== 4)
            throw new Error(`${context} uses unsupported shape type ${type}.`);

        const placementMode = AnimatorRuntimeUtils.requireIntegerProperty(module, "placementMode", context);
        if (placementMode !== 0)
            throw new Error(`${context} uses an unsupported placement mode.`);

        const radiusDefinition = AnimatorRuntimeUtils.requireRecord(AnimatorRuntimeUtils.requireProperty(module, "radius", context), `${context} radius`);
        const arcDefinition = AnimatorRuntimeUtils.requireRecord(AnimatorRuntimeUtils.requireProperty(module, "arc", context), `${context} arc`);

        if (AnimatorRuntimeUtils.requireIntegerProperty(radiusDefinition, "mode", `${context} radius`) !== 0)
            throw new Error(`${context} uses an animated radius.`);
        if (AnimatorRuntimeUtils.requireIntegerProperty(arcDefinition, "mode", `${context} arc`) !== 0)
            throw new Error(`${context} uses an animated arc.`);

        const radius = AnimatorRuntimeUtils.requireFiniteNumberProperty(radiusDefinition, "value", `${context} radius`);
        const radiusThickness = AnimatorRuntimeUtils.requireFiniteNumberProperty(module, "radiusThickness", context);
        const arcDegrees = AnimatorRuntimeUtils.requireFiniteNumberProperty(arcDefinition, "value", `${context} arc`);
        const angleDegrees = AnimatorRuntimeUtils.requireFiniteNumberProperty(module, "angle", context);

        if (radius < 0)
            throw new Error(`${context} has a negative radius.`);
        if (radiusThickness < 0 || radiusThickness > 1)
            throw new Error(`${context} has an invalid radius thickness.`);
        if (arcDegrees < 0 || arcDegrees > 360)
            throw new Error(`${context} has an invalid arc.`);
        if (angleDegrees < 0 || angleDegrees > 90)
            throw new Error(`${context} has an invalid cone angle.`);

        return Object.freeze({
            enabled: true,
            radius,
            radiusThickness,
            arcRadians: arcDegrees * Math.PI / 180,
            angleRadians: angleDegrees * Math.PI / 180,
            position: this.parseVector3(AnimatorRuntimeUtils.requireProperty(module, "m_Position", context), `${context} position`),
            rotation: this.parseVector3(AnimatorRuntimeUtils.requireProperty(module, "m_Rotation", context), `${context} rotation`),
            scale: this.parseVector3(AnimatorRuntimeUtils.requireProperty(module, "m_Scale", context), `${context} scale`)
        });
    }

    private parseTextureSheetModule(definition: AnimatorRuntimeParticleSystem): TextureSheetModule | null {
        const context = `ParticleSystem "${definition.id}" UVModule`;
        const module = this.requireModule(definition, "UVModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;

        const mode = AnimatorRuntimeUtils.requireIntegerProperty(module, "mode", context);
        const timeMode = AnimatorRuntimeUtils.requireIntegerProperty(module, "timeMode", context);
        const animationType = AnimatorRuntimeUtils.requireIntegerProperty(module, "animationType", context);

        if (mode !== 0)
            throw new Error(`${context} uses unsupported texture-sheet mode ${mode}.`);
        if (timeMode !== 0)
            throw new Error(`${context} does not animate by particle lifetime.`);
        if (animationType !== 0)
            throw new Error(`${context} does not animate the complete texture sheet.`);

        const columns = AnimatorRuntimeUtils.requireIntegerProperty(module, "tilesX", context);
        const rows = AnimatorRuntimeUtils.requireIntegerProperty(module, "tilesY", context);
        const cycles = AnimatorRuntimeUtils.requireFiniteNumberProperty(module, "cycles", context);

        if (columns < 1 || rows < 1 || columns > 64 || rows > 64)
            throw new Error(`${context} has invalid texture-sheet dimensions.`);
        if (cycles < 0)
            throw new Error(`${context} has an invalid cycle count.`);

        return Object.freeze({
            columns,
            rows,
            cycles,
            frameOverLifetime: AnimatorParticleMinMaxCurve.parse(
                AnimatorRuntimeUtils.requireProperty(module, "frameOverTime", context),
                `${context} frame over lifetime`
            ),
            startFrame: AnimatorParticleMinMaxCurve.parse(
                AnimatorRuntimeUtils.requireProperty(module, "startFrame", context),
                `${context} start frame`
            )
        });
    }

    private parseVelocityLimitModule(definition: AnimatorRuntimeParticleSystem): VelocityLimitModule | null {
        const context = `ParticleSystem "${definition.id}" ClampVelocityModule`;
        const module = this.requireModule(definition, "ClampVelocityModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;

        if (this.requireBoolean(module, "separateAxis", context))
            throw new Error(`${context} uses unsupported separate-axis velocity limits.`);
        if (this.requireBoolean(module, "inWorldSpace", context))
            throw new Error(`${context} uses an unsupported world-space velocity limit.`);

        const dampen = AnimatorRuntimeUtils.requireFiniteNumberProperty(module, "dampen", context);

        if (dampen < 0 || dampen > 1)
            throw new Error(`${context} has an invalid dampening value.`);

        return Object.freeze({
            magnitude: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "magnitude", context), `${context} magnitude`),
            drag: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "drag", context), `${context} drag`),
            dampen,
            multiplyDragByParticleSize: this.requireBoolean(module, "multiplyDragByParticleSize", context),
            multiplyDragByParticleVelocity: this.requireBoolean(module, "multiplyDragByParticleVelocity", context)
        });
    }

    private parseNoiseModule(definition: AnimatorRuntimeParticleSystem): NoiseModule | null {
        const context = `ParticleSystem "${definition.id}" NoiseModule`;
        const module = this.requireModule(definition, "NoiseModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;

        if (this.requireBoolean(module, "separateAxes", context))
            throw new Error(`${context} uses unsupported separate-axis noise.`);
        if (this.requireBoolean(module, "remapEnabled", context))
            throw new Error(`${context} uses unsupported noise remapping.`);

        const frequency = AnimatorRuntimeUtils.requireFiniteNumberProperty(module, "frequency", context);
        if (frequency <= 0)
            throw new Error(`${context} has an invalid frequency.`);

        const octaves = AnimatorRuntimeUtils.requireIntegerProperty(module, "octaves", context);
        if (octaves !== 1)
            throw new Error(`${context} uses unsupported multi-octave noise.`);

        const quality = AnimatorRuntimeUtils.requireIntegerProperty(module, "quality", context);
        if (quality !== 2)
            throw new Error(`${context} does not use high-quality noise.`);

        const rotationAmount = AnimatorParticleMinMaxCurve.parse(
            AnimatorRuntimeUtils.requireProperty(module, "rotationAmount", context),
            `${context} rotation amount`
        );

        const sizeAmount = AnimatorParticleMinMaxCurve.parse(
            AnimatorRuntimeUtils.requireProperty(module, "sizeAmount", context),
            `${context} size amount`
        );

        const samplePoints = [
            { time: 0, factor: 0 },
            { time: 0.5, factor: 0.5 },
            { time: 1, factor: 1 }
        ];

        if (samplePoints.some(({ time, factor }) => Math.abs(rotationAmount.evaluate(time, factor)) > this.EPSILON))
            throw new Error(`${context} uses unsupported rotational noise.`);
        if (samplePoints.some(({ time, factor }) => Math.abs(sizeAmount.evaluate(time, factor)) > this.EPSILON))
            throw new Error(`${context} uses unsupported size noise.`);

        return Object.freeze({
            strength: AnimatorParticleMinMaxCurve.parse(
                AnimatorRuntimeUtils.requireProperty(module, "strength", context),
                `${context} strength`
            ),
            scrollSpeed: AnimatorParticleMinMaxCurve.parse(
                AnimatorRuntimeUtils.requireProperty(module, "scrollSpeed", context),
                `${context} scroll speed`
            ),
            positionAmount: AnimatorParticleMinMaxCurve.parse(
                AnimatorRuntimeUtils.requireProperty(module, "positionAmount", context),
                `${context} position amount`
            ),
            frequency,
            damping: this.requireBoolean(module, "damping", context)
        });
    }

    private updateTextureFrame(particle: MutableParticle, normalizedAge: number) {
        const module = this.textureSheetModule;

        if (!module || !particle.textureFrameOverLifetime || !particle.textureStartFrame)
        {
            particle.textureFrame = 0;
            return;
        }

        const tileCount = module.columns * module.rows;
        const normalizedFrame = particle.textureStartFrame.evaluate(normalizedAge) + (particle.textureFrameOverLifetime.evaluate(normalizedAge) * module.cycles);
        const wrappedFrame = normalizedFrame - Math.floor(normalizedFrame);

        particle.textureFrame = Math.min(tileCount - 1, Math.floor(wrappedFrame * tileCount));
    }

    private applyVelocityLimit(particle: MutableParticle, normalizedAge: number, deltaSeconds: number) {
        const module = this.velocityLimitModule;
        const samples = particle.velocityLimit;

        if (!module || !samples)
            return;

        const velocity = particle.velocity;
        const speed = Math.hypot(velocity.x, velocity.y, velocity.z);

        if (speed <= this.EPSILON)
            return;

        const limit = Math.max(0, samples.magnitude.evaluate(normalizedAge));
        let targetSpeed = speed;

        if (targetSpeed > limit)
        {
            const excessSpeed = targetSpeed - limit;
            targetSpeed -= excessSpeed * module.dampen;
        }

        let drag = Math.max(0, samples.drag.evaluate(normalizedAge));

        if (module.multiplyDragByParticleSize)
            drag *= Math.max(0, particle.size);

        if (module.multiplyDragByParticleVelocity)
            drag *= targetSpeed;

        targetSpeed = Math.max(0, targetSpeed - (drag * deltaSeconds));

        if (targetSpeed <= this.EPSILON)
        {
            velocity.x = 0;
            velocity.y = 0;
            velocity.z = 0;
            return;
        }

        const scale = targetSpeed / speed;

        velocity.x *= scale;
        velocity.y *= scale;
        velocity.z *= scale;
    }

    private sampleNoiseVelocity(particle: MutableParticle, normalizedAge: number): MutableVector3 {
        const module = this.noiseModule;
        const samples = particle.noise;

        if (!module || !samples)
            return { x: 0, y: 0, z: 0 };

        const strength = samples.strength.evaluate(normalizedAge);
        const positionAmount = samples.positionAmount.evaluate(normalizedAge);
        const scroll = samples.scrollSpeed.evaluate(normalizedAge) * this.simulationTime;
        const effectiveStrength = strength * positionAmount * (module.damping ? module.frequency : 1);

        if (Math.abs(effectiveStrength) <= this.EPSILON)
            return { x: 0, y: 0, z: 0 };

        const frequency = module.frequency;
        const curl = this.sampleCurlNoise(
            (particle.position.x * frequency) + scroll,
            (particle.position.y * frequency) + (scroll * 0.754877666),
            (particle.position.z * frequency) + (scroll * 0.569840296)
        );

        return {
            x: curl.x * effectiveStrength,
            y: curl.y * effectiveStrength,
            z: curl.z * effectiveStrength
        };
    }

    private sampleCurlNoise(x: number, y: number, z: number): MutableVector3 {
        const step = 0.01;

        const derivative = (component: number, axis: 0 | 1 | 2): number => {
            let positiveX = x;
            let positiveY = y;
            let positiveZ = z;
            let negativeX = x;
            let negativeY = y;
            let negativeZ = z;

            if (axis === 0)
            {
                positiveX += step;
                negativeX -= step;
            }
            else if (axis === 1)
            {
                positiveY += step;
                negativeY -= step;
            }
            else
            {
                positiveZ += step;
                negativeZ -= step;
            }

            return (
                this.sampleNoisePotential(positiveX, positiveY, positiveZ, component) -
                this.sampleNoisePotential(negativeX, negativeY, negativeZ, component)
            ) / (step * 2);
        };

        const curl = {
            x: derivative(2, 1) - derivative(1, 2),
            y: derivative(0, 2) - derivative(2, 0),
            z: derivative(1, 0) - derivative(0, 1)
        };

        const magnitude = Math.hypot(curl.x, curl.y, curl.z);

        if (magnitude <= this.EPSILON)
            return { x: 0, y: 0, z: 0 };

        const scale = magnitude > 1
            ? 1 / magnitude
            : 1;

        return {
            x: curl.x * scale,
            y: curl.y * scale,
            z: curl.z * scale
        };
    }

    private sampleNoisePotential(x: number, y: number, z: number, component: number): number {
        const seed = (this.noiseSeed ^ Math.imul(component + 1, 0x85ebca6b)) >>> 0;
        return this.sampleValueNoise(x, y, z, seed);
    }

    private sampleValueNoise(x: number, y: number, z: number, seed: number): number {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const z0 = Math.floor(z);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const z1 = z0 + 1;

        const fade = (value: number) => value * value * value * (value * ((value * 6) - 15) + 10);

        const tx = fade(x - x0);
        const ty = fade(y - y0);
        const tz = fade(z - z0);

        const sample = (sampleX: number, sampleY: number, sampleZ: number) => this.sampleNoiseLattice(sampleX, sampleY, sampleZ, seed);

        const x00 = AnimatorRuntimeUtils.lerp(sample(x0, y0, z0), sample(x1, y0, z0), tx);
        const x10 = AnimatorRuntimeUtils.lerp(sample(x0, y1, z0), sample(x1, y1, z0), tx);
        const x01 = AnimatorRuntimeUtils.lerp(sample(x0, y0, z1), sample(x1, y0, z1), tx);
        const x11 = AnimatorRuntimeUtils.lerp(sample(x0, y1, z1), sample(x1, y1, z1), tx);

        return AnimatorRuntimeUtils.lerp(AnimatorRuntimeUtils.lerp(x00, x10, ty), AnimatorRuntimeUtils.lerp(x01, x11, ty), tz);
    }

    private sampleNoiseLattice(x: number, y: number, z: number, seed: number): number {
        let hash = seed;

        hash ^= Math.imul(x, 0x8da6b343);
        hash ^= Math.imul(y, 0xd8163841);
        hash ^= Math.imul(z, 0xcb1ab31f);
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x7feb352d);
        hash ^= hash >>> 15;
        hash = Math.imul(hash, 0x846ca68b);
        hash ^= hash >>> 16;

        return ((hash >>> 0) / 0xffffffff) * 2 - 1;
    }

    private validateSystem(definition: AnimatorRuntimeParticleSystem) {
        if (!definition.id || !definition.gameObjectId)
            throw new Error("A particle system has an invalid identity.");

        if (!Number.isFinite(definition.length) || definition.length <= 0)
            throw new Error(`ParticleSystem "${definition.id}" has an invalid duration.`);

        if (!Number.isFinite(definition.simulationSpeed) || definition.simulationSpeed < 0)
            throw new Error(`ParticleSystem "${definition.id}" has an invalid simulation speed.`);

        if (definition.moveWithTransform !== 0)
            throw new Error(`ParticleSystem "${definition.id}" does not use local simulation space.`);

        if (definition.scalingMode !== 0)
            throw new Error(`ParticleSystem "${definition.id}" uses an unsupported scaling mode.`);
    }

    private requireModule(definition: AnimatorRuntimeParticleSystem, name: string): ParticleObject {
        return AnimatorRuntimeUtils.requireRecord(definition.modules[name], `ParticleSystem "${definition.id}" ${name}`);
    }

    private parseVector3(value: AnimatorRuntimeParticleValue, context: string): AnimatorParticleVector3 {
        const object = AnimatorRuntimeUtils.requireRecord(value, context);

        return Object.freeze({
            x: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "x", context),
            y: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "y", context),
            z: AnimatorRuntimeUtils.requireFiniteNumberProperty(object, "z", context)
        });
    }

    private requireBoolean(object: ParticleObject, property: string, context: string): boolean {
        const value = AnimatorRuntimeUtils.requireProperty(object, property, context);

        if (typeof value !== "boolean")
            throw new Error(`${context}.${property} must be a boolean.`);

        return value;
    }

    private rotateEulerDegrees(vector: MutableVector3, rotation: AnimatorParticleVector3): MutableVector3 {
        const x = rotation.x * Math.PI / 180;
        const y = rotation.y * Math.PI / 180;
        const z = rotation.z * Math.PI / 180;

        const cosineX = Math.cos(x);
        const sineX = Math.sin(x);
        const cosineY = Math.cos(y);
        const sineY = Math.sin(y);
        const cosineZ = Math.cos(z);
        const sineZ = Math.sin(z);

        const afterX = {
            x: vector.x,
            y: (vector.y * cosineX) - (vector.z * sineX),
            z: (vector.y * sineX) + (vector.z * cosineX)
        };

        const afterY = {
            x: (afterX.x * cosineY) + (afterX.z * sineY),
            y: afterX.y,
            z: (-afterX.x * sineY) + (afterX.z * cosineY)
        };

        return {
            x: (afterY.x * cosineZ) - (afterY.y * sineZ),
            y: (afterY.x * sineZ) + (afterY.y * cosineZ),
            z: afterY.z
        };
    }

    private normalizeVector(vector: MutableVector3): MutableVector3 {
        const length = Math.hypot(vector.x, vector.y, vector.z);
        if (length <= this.EPSILON)
            return { x: 0, y: 1, z: 0 };

        return {
            x: vector.x / length,
            y: vector.y / length,
            z: vector.z / length
        };
    }

    private createRandomSeed(): number {
        const particleSystemId = this.definition.id;
        const configuredSeed = this.definition.randomSeed;

        if (!particleSystemId)
            throw new Error("The particle system ID cannot be empty.");
        if (!Number.isFinite(configuredSeed))
            throw new Error("The particle system seed must be finite.");

        const explicitSeed = configuredSeed >>> 0;
        if (explicitSeed !== 0)
            return explicitSeed;

        let hash = 0x811c9dc5;

        for (let i = 0; i < particleSystemId.length; i++) {
            hash ^= particleSystemId.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }

        return (hash >>> 0) || DEFAULT_ANIMATOR_PARTICLE_RANDOM_SEED;
    }

    private parseSizeOverLifetimeModule(definition: AnimatorRuntimeParticleSystem): AnimatorParticleMinMaxCurve | null {
        const context = `ParticleSystem "${definition.id}" SizeModule`;
        const module = this.requireModule(definition, "SizeModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;
        if (this.requireBoolean(module, "separateAxes", context))
            throw new Error(`${context} uses unsupported separate-axis sizing.`);

        return AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "curve", context), `${context} curve`);
    }

    private parseRotationOverLifetimeModule(definition: AnimatorRuntimeParticleSystem): RotationOverLifetimeModule | null {
        const context = `ParticleSystem "${definition.id}" RotationModule`;
        const module = this.requireModule(definition, "RotationModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;

        const separateAxes = this.requireBoolean(module, "separateAxes", context);

        return Object.freeze({
            x: separateAxes
                ? AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "x", context), `${context} X curve`)
                : null,
            y: separateAxes
                ? AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "y", context), `${context} Y curve`)
                : null,
            z: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "curve", context), `${context} Z curve`)
        });
    }

    private parseColorOverLifetimeModule(definition: AnimatorRuntimeParticleSystem): AnimatorParticleMinMaxGradient | null {
        const context = `ParticleSystem "${definition.id}" ColorModule`;
        const module = this.requireModule(definition, "ColorModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;

        return AnimatorParticleMinMaxGradient.parse(AnimatorRuntimeUtils.requireProperty(module, "gradient", context), `${context} gradient`);
    }

    private multiplyColors(left: AnimatorParticleColor, right: AnimatorParticleColor): AnimatorParticleColor {
        return Object.freeze({
            r: left.r * right.r,
            g: left.g * right.g,
            b: left.b * right.b,
            a: left.a * right.a
        });
    }
}
