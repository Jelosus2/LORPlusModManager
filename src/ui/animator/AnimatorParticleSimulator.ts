import type { AnimatorParticleColor, AnimatorParticleCurveSample, AnimatorParticleGradientSample } from "./AnimatorParticleValues";
import type { AnimatorRuntimeParticleSystem, AnimatorRuntimeParticleValue } from "./AnimatorBindingResolver";
import type { AnimatorMatrix4Source } from "./AnimatorMatrix4";

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
    initialSize: AnimatorParticleVector3;
    size: AnimatorParticleVector3;
    initialColor: AnimatorParticleColor;
    color: AnimatorParticleColor;
    textureFrame: number;
    simulationMatrix: Float64Array | null;
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

type SizeOverLifetimeModule = Readonly<{
    x: AnimatorParticleMinMaxCurve;
    y: AnimatorParticleMinMaxCurve | null;
    z: AnimatorParticleMinMaxCurve | null;
}>;

type SizeOverLifetimeSamples = Readonly<{
    x: AnimatorParticleCurveSample;
    y: AnimatorParticleCurveSample | null;
    z: AnimatorParticleCurveSample | null;
}>;

type ParticleSimulationFrame = Readonly<{
    matrix: Float64Array;
    gravityAcceleration: AnimatorParticleVector3;
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
    initialSize: AnimatorParticleVector3;
    size: MutableVector3;
    initialColor: AnimatorParticleColor;
    color: AnimatorParticleColor;
    gravity: AnimatorParticleCurveSample;
    noise: NoiseSamples | null;
    sizeOverLifetime: SizeOverLifetimeSamples | null;
    rotationOverLifetime: RotationOverLifetimeSamples | null;
    colorOverLifetime: AnimatorParticleGradientSample | null;
    textureFrame: number;
    textureFrameOverLifetime: AnimatorParticleCurveSample | null;
    textureStartFrame: AnimatorParticleCurveSample | null;
    worldSimulationFrame: ParticleSimulationFrame | null;
};

type ParticleObject = AnimatorRuntimeRecord<AnimatorRuntimeParticleValue>;

type InitialModule = Readonly<{
    lifetime: AnimatorParticleMinMaxCurve;
    speed: AnimatorParticleMinMaxCurve;
    sizeX: AnimatorParticleMinMaxCurve;
    sizeY: AnimatorParticleMinMaxCurve | null;
    sizeZ: AnimatorParticleMinMaxCurve | null;
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

type ParticleShapeType = 0 | 4 | 5 | 10 | 12;

type ParticleShapeModule = Readonly<{
    enabled: boolean;
    type: ParticleShapeType;
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
    private readonly shapeModule: ParticleShapeModule;
    private readonly textureSheetModule: TextureSheetModule | null;
    private readonly velocityLimitModule: VelocityLimitModule | null;
    private readonly noiseModule: NoiseModule | null;
    private readonly noiseSeed: number;
    private readonly startDelay: AnimatorParticleMinMaxCurve;
    private readonly sizeOverLifetime: SizeOverLifetimeModule | null;
    private readonly rotationOverLifetime: RotationOverLifetimeModule | null;
    private readonly colorOverLifetime: AnimatorParticleMinMaxGradient | null;
    private readonly particles: MutableParticle[] = [];
    private random!: AnimatorParticleRandom;
    private rateOverTimeSample!: AnimatorParticleCurveSample;
    private shapeRadius: number;
    private looping: boolean;
    private emitterWorldFrame: ParticleSimulationFrame | null = null;
    private initialBurstPending = false;
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
        this.shapeRadius = this.shapeModule.radius;
        this.sizeOverLifetime = this.parseSizeOverLifetimeModule(definition);
        this.rotationOverLifetime = this.parseRotationOverLifetimeModule(definition);
        this.velocityLimitModule = this.parseVelocityLimitModule(definition);
        this.noiseModule = this.parseNoiseModule(definition);
        this.noiseSeed = (this.createRandomSeed() ^ 0x9e3779b9) >>> 0;
        this.colorOverLifetime = this.parseColorOverLifetimeModule(definition);
        this.textureSheetModule = this.parseTextureSheetModule(definition);
        this.looping = definition.looping;

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

    get scalingMode(): 0 | 1 {
        return this.definition.scalingMode as 0 | 1;
    }

    get currentShapeRadius(): number {
        return this.shapeRadius;
    }

    get simulationSpace(): 0 | 1 {
        return this.definition.moveWithTransform as 0 | 1;
    }

    get currentLooping(): boolean {
        return this.looping;
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
            initialSize: Object.freeze({ ...particle.initialSize }),
            size: Object.freeze({ ...particle.size }),
            initialColor: particle.initialColor,
            color: particle.color,
            textureFrame: particle.textureFrame,
            simulationMatrix: particle.worldSimulationFrame?.matrix ?? null
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
        this.emitterWorldFrame = null;
        this.initialBurstPending = this.playing && this.delayRemaining <= this.EPSILON;
        this.looping = this.definition.looping;
    }

    resetAnimationOverrides() {
        this.looping = this.definition.looping;
        this.shapeRadius = this.shapeModule.radius;
    }

    play() {
        this.playing = true;
    }

    pause() {
        this.playing = false;
    }

    stop(clearParticles = true) {
        this.playing = false;
        this.initialBurstPending = false;
        this.cycleTime = 0;
        this.emissionRemainder = 0;

        if (clearParticles)
            this.particles.length = 0;
    }

    advance(deltaSeconds: number) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Particle simulation delta must be finite and non-negative.");

        if (this.initialBurstPending)
        {
            this.requireWorldSimulationFrameIfNeeded();
            this.emitBurstsAtTime(0);
            this.initialBurstPending = false;
        }

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

    setShapeRadius(value: number) {
        if (!Number.isFinite(value))
            throw new Error("Particle shape radius must be finite.");

        this.shapeRadius = Math.max(0, value);
    }

    setEmitterFrame(worldMatrix: AnimatorMatrix4Source, localGravityAcceleration: AnimatorParticleVector3) {
        if (worldMatrix.length !== 16 || Array.from(worldMatrix).some((component) => !Number.isFinite(component)))
            throw new Error(`ParticleSystem "${this.definition.id}" received an invalid emitter matrix.`);

        if (!Number.isFinite(localGravityAcceleration.x) || !Number.isFinite(localGravityAcceleration.y) || !Number.isFinite(localGravityAcceleration.z))
            throw new Error(`ParticleSystem "${this.definition.id}" received invalid gravity.`);

        this.setLocalGravityAcceleration(localGravityAcceleration);

        this.emitterWorldFrame = this.simulationSpace === 1
            ? Object.freeze({
                matrix: new Float64Array(worldMatrix),
                gravityAcceleration: Object.freeze({
                    x: localGravityAcceleration.x,
                    y: localGravityAcceleration.y,
                    z: localGravityAcceleration.z
                })
            })
            : null;
    }

    setLooping(value: boolean) {
        this.looping = value;
    }

    private updateParticles(deltaSeconds: number) {
        for (let i = this.particles.length - 1; i >= 0; i--)
        {
            const particle = this.particles[i];

            particle.age += deltaSeconds;

            if (particle.age >= particle.lifetime)
            {
                this.particles.splice(i, 1);
                continue;
            }

            const normalizedAge = AnimatorRuntimeUtils.clamp01(particle.age / particle.lifetime);

            this.updateParticlePresentation(particle, normalizedAge);

            if (particle.rotationOverLifetime)
            {
                particle.rotation.x += (particle.rotationOverLifetime.x?.evaluate(normalizedAge) ?? 0) * deltaSeconds;
                particle.rotation.y += (particle.rotationOverLifetime.y?.evaluate(normalizedAge) ?? 0) * deltaSeconds;
                particle.rotation.z += particle.rotationOverLifetime.z.evaluate(normalizedAge) * deltaSeconds;
            }

            const gravityModifier = particle.gravity.evaluate(normalizedAge);
            const gravityAcceleration = particle.worldSimulationFrame?.gravityAcceleration ?? this.gravityAcceleration;
            const gravityVelocity = {
                x: gravityAcceleration.x * gravityModifier * deltaSeconds,
                y: gravityAcceleration.y * gravityModifier * deltaSeconds,
                z: gravityAcceleration.z * gravityModifier * deltaSeconds
            };

            const noiseVelocity = this.sampleNoiseVelocity(particle, normalizedAge);
            let transientVelocity = noiseVelocity;

            if (this.velocityLimitModule)
            {
                transientVelocity = {
                    x: noiseVelocity.x + gravityVelocity.x,
                    y: noiseVelocity.y + gravityVelocity.y,
                    z: noiseVelocity.z + gravityVelocity.z
                };
            }
            else
            {
                particle.velocity.x += gravityVelocity.x;
                particle.velocity.y += gravityVelocity.y;
                particle.velocity.z += gravityVelocity.z;
            }

            const movementVelocity = this.applyVelocityLimit(particle, transientVelocity, normalizedAge, deltaSeconds);

            particle.position.x += movementVelocity.x * deltaSeconds;
            particle.position.y += movementVelocity.y * deltaSeconds;
            particle.position.z += movementVelocity.z * deltaSeconds;
        }
    }

    private updateParticlePresentation(particle: MutableParticle,normalizedAge: number) {
        this.updateTextureFrame(particle, normalizedAge);

        if (particle.sizeOverLifetime)
        {
            const xMultiplier = Math.max(0, particle.sizeOverLifetime.x.evaluate(normalizedAge));
            const yMultiplier = Math.max(0, particle.sizeOverLifetime.y?.evaluate(normalizedAge) ?? xMultiplier);
            const zMultiplier = Math.max(0, particle.sizeOverLifetime.z?.evaluate(normalizedAge) ?? xMultiplier);

            particle.size.x = particle.initialSize.x * xMultiplier;
            particle.size.y = particle.initialSize.y * yMultiplier;
            particle.size.z = particle.initialSize.z * zMultiplier;
        }

        if (particle.colorOverLifetime)
            particle.color = this.multiplyColors(particle.initialColor, particle.colorOverLifetime.evaluate(normalizedAge));
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

            if (!this.looping)
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
        const initialSizeX = Math.max(0, this.initialModule.sizeX.createSample(random).evaluate(0));

        const initialSize: MutableVector3 = {
            x: initialSizeX,
            y: Math.max(0, this.initialModule.sizeY?.createSample(random).evaluate(0) ?? initialSizeX),
            z: Math.max(0, this.initialModule.sizeZ?.createSample(random).evaluate(0) ?? initialSizeX)
        };

        const rotation = {
            x: this.initialModule.rotationX?.createSample(random).evaluate(0) ?? 0,
            y: this.initialModule.rotationY?.createSample(random).evaluate(0) ?? 0,
            z: this.initialModule.rotationZ.createSample(random).evaluate(0)
        };

        if (random.nextFloat() < this.initialModule.randomizeRotationDirection)
            rotation.z *= -1;

        const initialColor = this.initialModule.color.createSample(random).evaluate(0);
        const shape = this.sampleShape(random);
        const worldSimulationFrame = this.requireWorldSimulationFrameIfNeeded();

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
            size: { ...initialSize },
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
            sizeOverLifetime: this.sizeOverLifetime
                ? Object.freeze({
                    x: this.sizeOverLifetime.x.createSample(random),
                    y: this.sizeOverLifetime.y?.createSample(random) ?? null,
                    z: this.sizeOverLifetime.z?.createSample(random) ?? null
                })
                : null,
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
            textureStartFrame: this.textureSheetModule?.startFrame.createSample(random) ?? null,
            worldSimulationFrame
        };

        this.updateParticlePresentation(particle, 0);
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

        let localPosition: MutableVector3;
        let localDirection: MutableVector3;

        switch (this.shapeModule.type)
        {
            case 0:
            {
                const azimuth = random.nextFloat() * Math.PI * 2;
                const vertical = (random.nextFloat() * 2) - 1;
                const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));

                const unit = {
                    x: Math.cos(azimuth) * planar,
                    y: Math.sin(azimuth) * planar,
                    z: vertical
                };

                const minimumRadius = this.shapeRadius * (1 - this.shapeModule.radiusThickness);
                const radius = Math.cbrt(AnimatorRuntimeUtils.lerp(minimumRadius ** 3, this.shapeRadius ** 3, random.nextFloat()));

                localPosition = {
                    x: unit.x * radius * this.shapeModule.scale.x,
                    y: unit.y * radius * this.shapeModule.scale.y,
                    z: unit.z * radius * this.shapeModule.scale.z
                };

                localDirection = unit;
                break;
            }

            case 4:
            {
                const azimuth = random.nextFloat() * this.shapeModule.arcRadians;
                const minimumRadius = this.shapeRadius * (1 - this.shapeModule.radiusThickness);

                const radius = Math.sqrt(
                    AnimatorRuntimeUtils.lerp(
                        minimumRadius * minimumRadius,
                        this.shapeRadius * this.shapeRadius,
                        random.nextFloat()
                    )
                );

                const cosine = Math.cos(azimuth);
                const sine = Math.sin(azimuth);

                localPosition = {
                    x: cosine * radius * this.shapeModule.scale.x,
                    y: sine * radius * this.shapeModule.scale.y,
                    z: 0
                };

                const radialFraction = this.shapeRadius > this.EPSILON
                    ? radius / this.shapeRadius
                    : 0;

                const coneSine = Math.sin(this.shapeModule.angleRadians) * radialFraction;

                localDirection = {
                    x: cosine * coneSine,
                    y: sine * coneSine,
                    z: Math.cos(this.shapeModule.angleRadians)
                };

                break;
            }

            case 5:
            {
                localPosition = {
                    x: (random.nextFloat() - 0.5) * this.shapeModule.scale.x,
                    y: (random.nextFloat() - 0.5) * this.shapeModule.scale.y,
                    z: (random.nextFloat() - 0.5) * this.shapeModule.scale.z
                };

                localDirection = { x: 0, y: 0, z: 1 };
                break;
            }

            case 10:
            {
                const azimuth = random.nextFloat() * this.shapeModule.arcRadians;
                const minimumRadius = this.shapeRadius * (1 - this.shapeModule.radiusThickness);

                const radius = Math.sqrt(
                    AnimatorRuntimeUtils.lerp(minimumRadius * minimumRadius, this.shapeRadius * this.shapeRadius, random.nextFloat())
                );

                const cosine = Math.cos(azimuth);
                const sine = Math.sin(azimuth);

                localPosition = {
                    x: cosine * radius * this.shapeModule.scale.x,
                    y: sine * radius * this.shapeModule.scale.y,
                    z: 0
                };

                localDirection = {
                    x: cosine,
                    y: sine,
                    z: 0
                };

                break;
            }

            case 12:
            {
                const width = Math.abs(this.shapeModule.scale.x);
                const height = Math.abs(this.shapeModule.scale.y);
                const depth = Math.abs(this.shapeModule.scale.z);

                const xFaceArea = height * depth;
                const yFaceArea = width * depth;
                const zFaceArea = width * height;
                const totalFaceArea = xFaceArea + yFaceArea + zFaceArea;

                localPosition = {
                    x: (random.nextFloat() - 0.5) * width,
                    y: (random.nextFloat() - 0.5) * height,
                    z: (random.nextFloat() - 0.5) * depth
                };

                if (totalFaceArea > this.EPSILON)
                {
                    const selectedFace = random.nextFloat() * totalFaceArea;
                    const side = random.nextFloat() < 0.5 ? -0.5 : 0.5;

                    if (selectedFace < xFaceArea)
                        localPosition.x = side * width;
                    else if (selectedFace < xFaceArea + yFaceArea)
                        localPosition.y = side * height;
                    else
                        localPosition.z = side * depth;
                }

                localDirection = { x: 0, y: 0, z: 1 };
                break;
            }
        }

        const position = this.rotateEulerDegrees(localPosition, this.shapeModule.rotation);

        position.x += this.shapeModule.position.x;
        position.y += this.shapeModule.position.y;
        position.z += this.shapeModule.position.z;

        const direction = this.normalizeVector(this.rotateEulerDegrees(localDirection, this.shapeModule.rotation));

        return { position, direction };
    }

    private parseInitialModule(definition: AnimatorRuntimeParticleSystem): InitialModule {
        const context = `ParticleSystem "${definition.id}" InitialModule`;
        const module = this.requireModule(definition, "InitialModule");

        if (!this.requireBoolean(module, "enabled", context))
            throw new Error(`${context} must be enabled.`);

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
        const size3D = this.requireBoolean(module, "size3D", context);

        return Object.freeze({
            lifetime: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startLifetime", context), `${context} start lifetime`),
            speed: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startSpeed", context), `${context} start speed`),
            sizeX: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startSize", context), `${context} start X size`),
            sizeY: size3D
                ? AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startSizeY", context), `${context} start Y size`)
                : null,
            sizeZ: size3D
                ? AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "startSizeZ", context), `${context} start Z size`)
                : null,
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

    private parseShapeModule(definition: AnimatorRuntimeParticleSystem): ParticleShapeModule {
        const context = `ParticleSystem "${definition.id}" ShapeModule`;
        const module = this.requireModule(definition, "ShapeModule");
        const enabled = this.requireBoolean(module, "enabled", context);

        if (!enabled)
        {
            return Object.freeze({
                enabled: false,
                type: 4,
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
        if (type !== 0 && type !== 4 && type !== 5 && type !== 10 && type !== 12)
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
            type,
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

    private applyVelocityLimit(particle: MutableParticle, transientVelocity: MutableVector3, normalizedAge: number, deltaSeconds: number): MutableVector3 {
        const combinedVelocity = {
            x: particle.velocity.x + transientVelocity.x,
            y: particle.velocity.y + transientVelocity.y,
            z: particle.velocity.z + transientVelocity.z
        };

        const module = this.velocityLimitModule;
        const samples = particle.velocityLimit;

        if (!module || !samples)
            return combinedVelocity;

        const speed = Math.hypot(combinedVelocity.x, combinedVelocity.y, combinedVelocity.z);
        if (speed <= this.EPSILON)
            return combinedVelocity;

        const limit = Math.max(0, samples.magnitude.evaluate(normalizedAge));
        let targetSpeed = speed;

        if (speed > limit)
        {
            const retention = Math.pow(Math.max(0, 1 - module.dampen), deltaSeconds * 30);
            targetSpeed = limit + ((speed - limit) * retention);
        }

        let drag = Math.max(0, samples.drag.evaluate(normalizedAge));

        if (module.multiplyDragByParticleSize)
            drag *= Math.max(particle.size.x, particle.size.y, particle.size.z);

        if (module.multiplyDragByParticleVelocity)
            drag *= targetSpeed;

        targetSpeed = Math.max(0, targetSpeed - (drag * deltaSeconds));

        if (targetSpeed <= this.EPSILON)
        {
            particle.velocity.x = -transientVelocity.x;
            particle.velocity.y = -transientVelocity.y;
            particle.velocity.z = -transientVelocity.z;

            return { x: 0, y: 0, z: 0 };
        }

        const scale = targetSpeed / speed;

        const limitedVelocity = {
            x: combinedVelocity.x * scale,
            y: combinedVelocity.y * scale,
            z: combinedVelocity.z * scale
        };

        particle.velocity.x = limitedVelocity.x - transientVelocity.x;
        particle.velocity.y = limitedVelocity.y - transientVelocity.y;
        particle.velocity.z = limitedVelocity.z - transientVelocity.z;

        return limitedVelocity;
    }

    private sampleNoiseVelocity(particle: MutableParticle, normalizedAge: number): MutableVector3 {
        const module = this.noiseModule;
        const samples = particle.noise;

        if (!module || !samples)
            return { x: 0, y: 0, z: 0 };

        const strength = samples.strength.evaluate(normalizedAge);
        const positionAmount = samples.positionAmount.evaluate(normalizedAge);
        const frequency = module.frequency;
        const scroll = samples.scrollSpeed.evaluate(normalizedAge) * this.simulationTime * frequency;

        const dampingScale = module.damping
            ? 1 / frequency
            : 1;

        const effectiveStrength = strength * positionAmount * dampingScale * frequency;

        if (Math.abs(effectiveStrength) <= this.EPSILON)
            return { x: 0, y: 0, z: 0 };

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

        if (!Number.isFinite(curl.x) || !Number.isFinite(curl.y) || !Number.isFinite(curl.z))
            throw new Error(`ParticleSystem "${this.definition.id}" generated invalid curl noise.`);

        return curl;
    }

    private sampleNoisePotential(x: number, y: number, z: number, component: number): number {
        const seed = (this.noiseSeed ^ Math.imul(component + 1, 0x85ebca6b)) >>> 0;
        return this.sampleGradientNoise(x, y, z, seed);
    }

    private sampleGradientNoise(x: number, y: number, z: number, seed: number): number {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const z0 = Math.floor(z);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const z1 = z0 + 1;

        const fade = (value: number): number => value * value * value * (value * ((value * 6) - 15) + 10);
        const interpolate = (left: number, right: number, amount: number): number => left + ((right - left) * amount);

        const tx = fade(x - x0);
        const ty = fade(y - y0);
        const tz = fade(z - z0);

        const gradientDot = (latticeX: number, latticeY: number, latticeZ: number): number => {
            const hash = this.hashNoiseLattice(latticeX, latticeY, latticeZ, seed);

            let gradientX = 0;
            let gradientY = 0;
            let gradientZ = 0;

            switch (hash % 12)
            {
                case 0:
                    gradientX = 1;
                    gradientY = 1;
                    break;
                case 1:
                    gradientX = -1;
                    gradientY = 1;
                    break;
                case 2:
                    gradientX = 1;
                    gradientY = -1;
                    break;
                case 3:
                    gradientX = -1;
                    gradientY = -1;
                    break;
                case 4:
                    gradientX = 1;
                    gradientZ = 1;
                    break;
                case 5:
                    gradientX = -1;
                    gradientZ = 1;
                    break;
                case 6:
                    gradientX = 1;
                    gradientZ = -1;
                    break;
                case 7:
                    gradientX = -1;
                    gradientZ = -1;
                    break;
                case 8:
                    gradientY = 1;
                    gradientZ = 1;
                    break;
                case 9:
                    gradientY = -1;
                    gradientZ = 1;
                    break;
                case 10:
                    gradientY = 1;
                    gradientZ = -1;
                    break;
                default:
                    gradientY = -1;
                    gradientZ = -1;
                    break;
            }

            return gradientX * (x - latticeX) + gradientY * (y - latticeY) + gradientZ * (z - latticeZ);
        };

        const x00 = interpolate(gradientDot(x0, y0, z0), gradientDot(x1, y0, z0), tx);
        const x10 = interpolate(gradientDot(x0, y1, z0), gradientDot(x1, y1, z0), tx);
        const x01 = interpolate(gradientDot(x0, y0, z1), gradientDot(x1, y0, z1), tx);
        const x11 = interpolate(gradientDot(x0, y1, z1), gradientDot(x1, y1, z1), tx);

        return interpolate(interpolate(x00, x10, ty), interpolate(x01, x11, ty), tz);
    }

    private hashNoiseLattice(x: number, y: number, z: number, seed: number): number {
        let hash = seed;

        hash ^= Math.imul(x, 0x8da6b343);
        hash ^= Math.imul(y, 0xd8163841);
        hash ^= Math.imul(z, 0xcb1ab31f);
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x7feb352d);
        hash ^= hash >>> 15;
        hash = Math.imul(hash, 0x846ca68b);
        hash ^= hash >>> 16;

        return hash >>> 0;
    }

    private validateSystem(definition: AnimatorRuntimeParticleSystem) {
        if (!definition.id || !definition.gameObjectId)
            throw new Error("A particle system has an invalid identity.");

        if (!Number.isFinite(definition.length) || definition.length <= 0)
            throw new Error(`ParticleSystem "${definition.id}" has an invalid duration.`);

        if (!Number.isFinite(definition.simulationSpeed) || definition.simulationSpeed < 0)
            throw new Error(`ParticleSystem "${definition.id}" has an invalid simulation speed.`);

        if (definition.moveWithTransform !== 0 && definition.moveWithTransform !== 1)
            throw new Error(`ParticleSystem "${definition.id}" uses unsupported custom simulation space.`);

        if (definition.scalingMode !== 0 && definition.scalingMode !== 1)
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

    private requireWorldSimulationFrameIfNeeded(): ParticleSimulationFrame | null {
        if (this.simulationSpace === 0)
            return null;

        if (!this.emitterWorldFrame)
            throw new Error(`ParticleSystem "${this.definition.id}" has no evaluated world-space emission frame.`);

        return this.emitterWorldFrame;
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

    private parseSizeOverLifetimeModule(definition: AnimatorRuntimeParticleSystem): SizeOverLifetimeModule | null {
        const context = `ParticleSystem "${definition.id}" SizeModule`;
        const module = this.requireModule(definition, "SizeModule");

        if (!this.requireBoolean(module, "enabled", context))
            return null;

        const separateAxes = this.requireBoolean(module, "separateAxes", context);

        return Object.freeze({
            x: AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "curve", context), `${context} X curve`),
            y: separateAxes
                ? AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "y", context), `${context} Y curve`)
                : null,
            z: separateAxes
                ? AnimatorParticleMinMaxCurve.parse(AnimatorRuntimeUtils.requireProperty(module, "z", context), `${context} Z curve`)
                : null
        });
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
