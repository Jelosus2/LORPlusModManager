import type { AnimatorControllerDefinition, AnimatorParameterIdentifier } from "./AnimatorControllerEvaluator";
import type { AnimatorModPreviewPreparation } from "../../shared/characters";
import type { AnimatorAnimationManifest } from "./AnimatorAnimationSampler";
import type { AnimatorGeometryManifest } from "./AnimatorGeometryReader";
import type { AnimatorRuntimeScene } from "./AnimatorBindingResolver";

import { AnimatorParticleRendererModel } from "./AnimatorParticleRendererModel";
import { AnimatorControllerEvaluator } from "./AnimatorControllerEvaluator";
import { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import { AnimatorParticleSimulator } from "./AnimatorParticleSimulator";
import { AnimatorPuppet2DIkSolver } from "./AnimatorPuppet2DIkSolver";
import { AnimatorAnimationSampler } from "./AnimatorAnimationSampler";
import { AnimatorPreparedGeometry } from "./AnimatorPreparedGeometry";
import { AnimatorScenePoseApplier } from "./AnimatorScenePoseApplier";
import { AnimatorSpriteProjector } from "./AnimatorSpriteProjector";
import { AnimatorGeometryReader } from "./AnimatorGeometryReader";
import { AnimatorPoseEvaluator } from "./AnimatorPoseEvaluator";
import { AnimatorRendererModel } from "./AnimatorRendererModel";
import { AnimatorMeshDeformer } from "./AnimatorMeshDeformer";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";
import { AnimatorSceneState } from "./AnimatorSceneState";

export type AnimatorRuntimeTexture = Readonly<{
    id: string;
    name: string;
    assetName: string;
    file: string;
    sha256: string;
    width: number;
    height: number;
}>;

export type AnimatorRuntimeManifest = Readonly<{
    formatVersion: number;
    bundleName: string;
    locator: string;
    scene: AnimatorRuntimeScene;
    controllers: readonly AnimatorControllerDefinition[];
    geometry: AnimatorGeometryManifest;
    animations: AnimatorAnimationManifest;
    textures: readonly AnimatorRuntimeTexture[];
}>;

export type AnimatorRuntimeFrameResult = Readonly<{
    diagnostics: readonly string[];
}>;

export class AnimatorRuntimePackage {
    private static readonly MAXIMUM_MANIFEST_LENGTH = 32 * 1024 * 1024;
    private static readonly WORLD_GRAVITY_Y = -9.81;
    private static readonly MATRIX_DETERMINANT_EPSILON = 1e-12;
    private readonly textureUrlsById = new Map<string, string>();
    private readonly controllerEvaluatorsByAnimatorId = new Map<string, AnimatorControllerEvaluator>();
    private readonly poseEvaluator: AnimatorPoseEvaluator;
    private readonly poseApplier: AnimatorScenePoseApplier;
    private readonly puppet2dIkSolver: AnimatorPuppet2DIkSolver;
    private readonly particleSimulatorsById = new Map<string, AnimatorParticleSimulator>();
    private readonly particleInitializationDiagnostics: string[] = [];
    readonly state: AnimatorSceneState;
    readonly hierarchy: AnimatorTransformHierarchy;
    readonly geometryReader: AnimatorGeometryReader;
    readonly animationSampler: AnimatorAnimationSampler;
    readonly preparedGeometry: AnimatorPreparedGeometry;
    readonly renderers: AnimatorRendererModel;
    readonly meshDeformer: AnimatorMeshDeformer;
    readonly spriteProjector: AnimatorSpriteProjector;
    readonly particleRenderers: AnimatorParticleRendererModel;

    private constructor(
        readonly manifest: AnimatorRuntimeManifest,
        geometryBinary: ArrayBuffer,
        animationBinary: ArrayBuffer,
        private readonly runtimeRootUrl: string
    ) {
        this.geometryReader = new AnimatorGeometryReader(manifest.geometry, geometryBinary);
        this.animationSampler = new AnimatorAnimationSampler(manifest.animations, animationBinary);
        this.animationSampler.validateAllClips();

        this.state = new AnimatorSceneState(manifest.scene);
        this.hierarchy = new AnimatorTransformHierarchy(manifest.scene);
        this.preparedGeometry = new AnimatorPreparedGeometry(manifest.scene, this.geometryReader);
        this.renderers = new AnimatorRendererModel(manifest.scene, this.preparedGeometry, this.hierarchy);
        this.meshDeformer = new AnimatorMeshDeformer(this.renderers, this.state, this.hierarchy);
        this.spriteProjector = new AnimatorSpriteProjector(manifest.scene, this.renderers.spriteRenderers, this.preparedGeometry, this.state, this.hierarchy);
        this.poseEvaluator = new AnimatorPoseEvaluator(manifest.scene, this.animationSampler);
        this.poseApplier = new AnimatorScenePoseApplier(this.state);
        this.puppet2dIkSolver = new AnimatorPuppet2DIkSolver(manifest.scene, this.state, this.hierarchy);

        this.indexTextures();
        this.initializeControllers();
        this.initializeParticleSimulators();

        this.particleRenderers = new AnimatorParticleRendererModel(manifest.scene, this.particleSimulatorsById, this.hierarchy);
        this.particleInitializationDiagnostics.push(...this.particleRenderers.diagnostics);

        this.reset();
    }

    get particleSimulators(): ReadonlyMap<string, AnimatorParticleSimulator> {
        return this.particleSimulatorsById;
    }

    static async load(preparation: AnimatorModPreviewPreparation, signal?: AbortSignal): Promise<AnimatorRuntimePackage> {
        const runtimeRootUrl = AnimatorRuntimePackage.createRuntimeRootUrl(preparation);
        const manifestUrl = `${runtimeRootUrl}/runtime.json`;
        const manifestText = await AnimatorRuntimePackage.fetchText(manifestUrl, signal);

        if (manifestText.length === 0 || manifestText.length > AnimatorRuntimePackage.MAXIMUM_MANIFEST_LENGTH)
            throw new Error("The Animator runtime manifest has an invalid size.");

        let parsedManifest: unknown;

        try
        {
            parsedManifest = JSON.parse(manifestText);
        }
        catch
        {
            throw new Error("The Animator runtime manifest is not valid JSON.");
        }

        const manifest = AnimatorRuntimePackage.parseManifest(parsedManifest);
        AnimatorRuntimePackage.validateManifestIdentity(manifest, preparation);

        const [geometryBinary, animationBinary] = await Promise.all([
            AnimatorRuntimePackage.fetchBinary(`${runtimeRootUrl}/${manifest.geometry.file}`, signal),
            AnimatorRuntimePackage.fetchBinary(`${runtimeRootUrl}/${manifest.animations.file}`, signal)
        ]);

        return new AnimatorRuntimePackage(
            manifest,
            geometryBinary,
            animationBinary,
            runtimeRootUrl
        );
    }

    advance(deltaSeconds: number): AnimatorRuntimeFrameResult {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("Animator frame delta must be a finite non-negative number.");

        const poses = [];
        const diagnostics: string[] = [];
        const diagnosticKeys = new Set<string>();

        for (const diagnostic of this.particleInitializationDiagnostics)
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        for (const animator of this.manifest.scene.animators)
        {
            const controller = this.controllerEvaluatorsByAnimatorId.get(animator.id);
            if (!controller)
                continue;

            const samples = controller.update(deltaSeconds);
            const pose = this.poseEvaluator.evaluate(animator.id, samples);

            poses.push(pose);

            for (const diagnostic of pose.diagnostics)
                AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic.message);
        }

        const applicationResult = this.poseApplier.apply(poses);

        for (const diagnostic of applicationResult.diagnostics)
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        this.hierarchy.update(this.state);

        for (const diagnostic of this.puppet2dIkSolver.solve())
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        for (const diagnostic of this.updateParticleGravity())
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        this.meshDeformer.update();
        this.spriteProjector.update();

        for (const simulator of this.particleSimulatorsById.values())
            simulator.advance(deltaSeconds);

        return { diagnostics };
    }

    reset(): AnimatorRuntimeFrameResult {
        for (const controller of this.controllerEvaluatorsByAnimatorId.values())
            controller.reset();

        for (const simulator of this.particleSimulatorsById.values())
            simulator.reset();

        return this.advance(0);
    }

    requireControllerForAnimator(animatorId: string): AnimatorControllerEvaluator {
        const controller = this.controllerEvaluatorsByAnimatorId.get(animatorId);
        if (!controller)
            throw new Error(`Animator "${animatorId}" has no runtime controller.`);

        return controller;
    }

    getTextureUrl(textureId: string): string | null {
        return this.textureUrlsById.get(textureId) ?? null;
    }

    requireTextureUrl(textureId: string): string {
        const url = this.getTextureUrl(textureId);
        if (!url)
            throw new Error(`Texture "${textureId}" is missing from the Animator runtime package.`);

        return url;
    }

    hasTriggerParameter(identifier: AnimatorParameterIdentifier): boolean {
        for (const controller of this.controllerEvaluatorsByAnimatorId.values())
        {
            if (controller.hasParameter(identifier, "trigger"))
                return true;
        }

        return false;
    }

    triggerParameter(identifier: AnimatorParameterIdentifier): number {
        let triggeredControllers = 0;

        for (const controller of this.controllerEvaluatorsByAnimatorId.values())
        {
            if (!controller.hasParameter(identifier, "trigger"))
                continue;

            controller.setTrigger(identifier);
            triggeredControllers++;
        }

        return triggeredControllers;
    }

    private initializeControllers() {
        const controllersById = new Map<string, AnimatorControllerDefinition>();

        for (const controller of this.manifest.controllers)
        {
            if (!controller.id)
                throw new Error("An Animator controller has no ID.");
            if (controllersById.has(controller.id))
                throw new Error(`Animator controller "${controller.id}" is duplicated.`);

            controllersById.set(controller.id, controller);
        }

        for (const animator of this.manifest.scene.animators)
        {
            if (!animator.controllerId)
                continue;

            const controller = controllersById.get(animator.controllerId);
            if (!controller)
                throw new Error(`Animator "${animator.id}" references missing controller "${animator.controllerId}".`);

            this.controllerEvaluatorsByAnimatorId.set(animator.id, new AnimatorControllerEvaluator(controller, this.manifest.animations.clips));
        }
    }

    private initializeParticleSimulators() {
        const particleSystemIds = new Set<string>();

        for (const definition of this.manifest.scene.particleSystems)
        {
            if (!definition.id)
                throw new Error("A ParticleSystem has no ID.");
            if (particleSystemIds.has(definition.id))
                throw new Error(`ParticleSystem "${definition.id}" is duplicated.`);

            particleSystemIds.add(definition.id);

            try
            {
                this.particleSimulatorsById.set(definition.id, new AnimatorParticleSimulator(definition));
            }
            catch (error)
            {
                const reason = error instanceof Error
                    ? error.message
                    : "The particle system uses an unsupported configuration.";

                this.particleInitializationDiagnostics.push(`ParticleSystem "${definition.id}" could not be previewed. ${reason}`);
            }
        }
    }

    private indexTextures() {
        const textureIds = new Set<string>();
        const textureFiles = new Set<string>();

        for (const texture of this.manifest.textures)
        {
            if (textureIds.has(texture.id))
                throw new Error(`Texture "${texture.id}" is duplicated.`);
            if (textureFiles.has(texture.file))
                throw new Error(`Animator texture file "${texture.file}" is duplicated.`);
            if (!/^[0-9a-f]{64}$/i.test(texture.sha256) || texture.file !== `textures/${texture.sha256.toLowerCase()}.png`)
                throw new Error(`Texture "${texture.name}" has an invalid package path.`);
            if (!Number.isSafeInteger(texture.width) || !Number.isSafeInteger(texture.height) || texture.width <= 0 || texture.height <= 0)
                throw new Error(`Texture "${texture.name}" has invalid dimensions.`);

            textureIds.add(texture.id);
            textureFiles.add(texture.file);

            this.textureUrlsById.set(texture.id, `${this.runtimeRootUrl}/${texture.file}`);
        }

        for (const material of this.manifest.scene.materials)
        {
            for (const property of material.textureProperties)
            {
                if (property.textureId && !textureIds.has(property.textureId))
                    throw new Error(`Material "${material.name}" references missing texture "${property.textureId}".`);
            }
        }

        for (const sprite of this.manifest.scene.sprites)
        {
            if (sprite.textureId && !textureIds.has(sprite.textureId))
                throw new Error(`Sprite "${sprite.name}" references missing texture "${sprite.textureId}".`);
            if (sprite.alphaTextureId && !textureIds.has(sprite.alphaTextureId))
                throw new Error(`Sprite "${sprite.name}" references missing alpha texture "${sprite.alphaTextureId}".`);
        }
    }

    private updateParticleGravity(): readonly string[] {
        const diagnostics: string[] = [];

        for (const simulator of this.particleSimulatorsById.values())
        {
            const matrix = this.hierarchy.requireWorldMatrixForGameObject(simulator.gameObjectId);

            const a = matrix[0];
            const b = matrix[1];
            const c = matrix[2];
            const d = matrix[4];
            const e = matrix[5];
            const f = matrix[6];
            const g = matrix[8];
            const h = matrix[9];
            const i = matrix[10];

            const determinant =
                a * (e * i - f * h) -
                b * (d * i - f * g) +
                c * (d * h - e * g);

            if (!Number.isFinite(determinant) || Math.abs(determinant) <= AnimatorRuntimePackage.MATRIX_DETERMINANT_EPSILON) {
                simulator.setLocalGravityAcceleration({
                    x: 0,
                    y: 0,
                    z: 0
                });

                diagnostics.push(`ParticleSystem "${simulator.particleSystemId}" cannot apply world gravity because its Transform is singular.`);
                continue;
            }

            const gravityY = AnimatorRuntimePackage.WORLD_GRAVITY_Y;

            simulator.setLocalGravityAcceleration({
                x: ((c * h - b * i) * gravityY) / determinant,
                y: ((a * i - c * g) * gravityY) / determinant,
                z: ((b * g - a * h) * gravityY) / determinant
            });
        }

        return diagnostics;
    }

    private static createRuntimeRootUrl(preparation: AnimatorModPreviewPreparation): string {
        const runtime = preparation.runtime;

        return [
            "lorplus-preview-asset://runtime",
            encodeURIComponent(runtime.bundleName),
            encodeURIComponent(runtime.versionHash),
            encodeURIComponent(runtime.cacheKey)
        ].join("/");
    }

    private static validateManifestIdentity(manifest: AnimatorRuntimeManifest, preparation: AnimatorModPreviewPreparation) {
        const runtime = preparation.runtime;

        if (manifest.formatVersion !== runtime.formatVersion)
            throw new Error(`Expected Animator runtime format ${runtime.formatVersion}, but received format ${manifest.formatVersion}.`);
        if (manifest.bundleName !== runtime.bundleName)
            throw new Error("The Animator runtime package belongs to a different game bundle.");
        if (manifest.locator !== preparation.skin2dId)
            throw new Error("The Animator runtime package belongs to a different character skin.");
    }

    private static parseManifest(value: unknown): AnimatorRuntimeManifest {
        const root = AnimatorRuntimeUtils.requireRecord(value, "Animator runtime manifest");

        AnimatorRuntimePackage.requireSafeInteger(root.formatVersion, "Animator runtime format version");
        AnimatorRuntimePackage.requireString(root.bundleName, "Animator runtime bundle name");
        AnimatorRuntimePackage.requireString(root.locator, "Animator runtime locator");
        AnimatorRuntimeUtils.requireRecord(root.scene, "Animator runtime scene");
        AnimatorRuntimePackage.requireArray(root.controllers, "Animator runtime controllers");
        AnimatorRuntimeUtils.requireRecord(root.geometry, "Animator geometry manifest");
        AnimatorRuntimeUtils.requireRecord(root.animations, "Animator animation manifest");

        const rawTextures = AnimatorRuntimePackage.requireArray(root.textures, "Animator runtime textures");
        const textures = rawTextures.map((texture, index) => AnimatorRuntimePackage.parseTexture(texture, index));

        return {
            formatVersion: root.formatVersion as number,
            bundleName: root.bundleName as string,
            locator: root.locator as string,
            scene: root.scene as AnimatorRuntimeScene,
            controllers: root.controllers as readonly AnimatorControllerDefinition[],
            geometry: root.geometry as AnimatorGeometryManifest,
            animations: root.animations as AnimatorAnimationManifest,
            textures
        };
    }

    private static parseTexture(value: unknown, index: number): AnimatorRuntimeTexture {
        const texture = AnimatorRuntimeUtils.requireRecord(value, `Animator texture ${index}`);
        const id = AnimatorRuntimePackage.requireString(texture.id, `Animator texture ${index} ID`);
        const name = AnimatorRuntimePackage.requireString(texture.name, `Animator texture ${index} name`);
        const assetName = AnimatorRuntimePackage.requireString(texture.assetName, `Animator texture ${index} asset name`);
        const file = AnimatorRuntimePackage.requireString(texture.file, `Animator texture ${index} file`);
        const sha256 = AnimatorRuntimePackage.requireString(texture.sha256, `Animator texture ${index} checksum`);
        const width = AnimatorRuntimePackage.requireSafeInteger(texture.width, `Animator texture ${index} width`);
        const height = AnimatorRuntimePackage.requireSafeInteger(texture.height, `Animator texture ${index} height`);

        return {
            id,
            name,
            assetName,
            file,
            sha256,
            width,
            height
        };
    }

    private static async fetchText(url: string, signal?: AbortSignal): Promise<string> {
        const response = await fetch(url, {
            method: "GET",
            signal
        });

        if (!response.ok)
            throw new Error(`Could not load the Animator runtime manifest (${response.status}).`);

        return await response.text();
    }

    private static async fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
        const response = await fetch(url, {
            method: "GET",
            signal
        });

        if (!response.ok)
            throw new Error(`Could not load an Animator runtime binary (${response.status}).`);

        return await response.arrayBuffer();
    }

    private static requireArray(value: unknown, context: string): readonly unknown[] {
        if (!Array.isArray(value))
            throw new Error(`${context} is invalid.`);

        return value;
    }

    private static requireString(value: unknown, context: string): string {
        if (typeof value !== "string" || value.length === 0)
            throw new Error(`${context} is invalid.`);

        return value;
    }

    private static requireSafeInteger(value: unknown, context: string): number {
        if (typeof value !== "number" || !Number.isSafeInteger(value))
            throw new Error(`${context} is invalid.`);

        return value;
    }
}
