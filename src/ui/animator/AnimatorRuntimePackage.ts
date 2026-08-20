import type { AnimatorControllerDefinition, AnimatorParameterIdentifier } from "./AnimatorControllerEvaluator";
import type { AnimatorRuntimeScene, AnimatorRuntimeBackgroundPartGroup } from "./AnimatorBindingResolver";
import type { AnimatorModPreviewPreparation } from "../../shared/characters";
import type { AnimatorAnimationManifest } from "./AnimatorAnimationSampler";
import type { AnimatorGeometryManifest } from "./AnimatorGeometryReader";

import { AnimatorParticleRendererModel } from "./AnimatorParticleRendererModel";
import { AnimatorPuppet2DSplineSolver } from "./AnimatorPuppet2DSplineSolver";
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

export type AnimatorRuntimeTextureWrapMode = 0 | 1 | 2 | 3;

export type AnimatorRuntimeTexture = Readonly<{
    id: string;
    name: string;
    assetName: string;
    file: string;
    sha256: string;
    width: number;
    height: number;
    wrapModeU: AnimatorRuntimeTextureWrapMode;
    wrapModeV: AnimatorRuntimeTextureWrapMode;
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
    private readonly textureUrlsById = new Map<string, string>();
    private readonly controllerEvaluatorsByAnimatorId = new Map<string, AnimatorControllerEvaluator>();
    private readonly poseEvaluator: AnimatorPoseEvaluator;
    private readonly poseApplier: AnimatorScenePoseApplier;
    private readonly puppet2dIkSolver: AnimatorPuppet2DIkSolver;
    private readonly puppet2dSplineSolver: AnimatorPuppet2DSplineSolver;
    private readonly particleSimulatorsById = new Map<string, AnimatorParticleSimulator>();
    private readonly particleInitializationDiagnostics: string[] = [];
    private readonly decoration1States = new Map<string, boolean>();
    private readonly decoration2States = new Map<string, boolean>();
    private readonly particleActiveStates = new Map<string, boolean>();
    private rPlusEnabled = false;
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

        this.initializeDecorationStates();

        this.hierarchy = new AnimatorTransformHierarchy(manifest.scene);
        this.preparedGeometry = new AnimatorPreparedGeometry(manifest.scene, this.geometryReader);
        this.renderers = new AnimatorRendererModel(manifest.scene, this.preparedGeometry, this.hierarchy);
        this.meshDeformer = new AnimatorMeshDeformer(this.renderers, this.state, this.hierarchy);
        this.spriteProjector = new AnimatorSpriteProjector(manifest.scene, this.renderers.spriteRenderers, this.preparedGeometry, this.state, this.hierarchy);
        this.poseEvaluator = new AnimatorPoseEvaluator(manifest.scene, this.animationSampler);
        this.poseApplier = new AnimatorScenePoseApplier(this.state, this.particleSimulatorsById);
        this.puppet2dIkSolver = new AnimatorPuppet2DIkSolver(manifest.scene, this.state, this.hierarchy);
        this.puppet2dSplineSolver = new AnimatorPuppet2DSplineSolver(manifest.scene, this.state, this.hierarchy);

        this.indexTextures();
        this.initializeControllers();
        this.initializeParticleSimulators();

        this.particleRenderers = new AnimatorParticleRendererModel(manifest.scene, this.particleSimulatorsById, this.hierarchy, this.preparedGeometry);
        this.particleInitializationDiagnostics.push(...this.particleRenderers.diagnostics);

        this.reset();
    }

    get particleSimulators(): ReadonlyMap<string, AnimatorParticleSimulator> {
        return this.particleSimulatorsById;
    }

    get hasRPlusPresentation(): boolean {
        const rplus = this.manifest.scene.interactions.rplus;

        return (
            rplus.materialSwitchers.some((switcher) => switcher.bindings.some((binding) => binding.rplusTextureId !== null)) ||
            rplus.spriteSwitchers.some((switcher) => switcher.bindings.some((binding) => binding.rplusSpriteId !== null))
        );
    }

    get isRPlusEnabled(): boolean {
        return this.rPlusEnabled;
    }

    get hasDecoration1(): boolean {
        return this.manifest.scene.interactions.partsViews.some((view) => this.hasPartGroupObjects(view.part1));
    }

    get hasDecoration2(): boolean {
        return this.manifest.scene.interactions.partsViews.some((view) => this.hasPartGroupObjects(view.part2));
    }

    get isDecoration1Enabled(): boolean {
        const views = this.manifest.scene.interactions.partsViews.filter((view) => this.hasPartGroupObjects(view.part1));

        return (
            views.length > 0 &&
            views.every((view) => this.decoration1States.get(view.componentId) ?? view.part1.defaultEnabled)
        );
    }

    get isDecoration2Enabled(): boolean {
        const views = this.manifest.scene.interactions.partsViews.filter((view) => this.hasPartGroupObjects(view.part2));

        return (
            views.length > 0 &&
            views.every((view) => this.decoration2States.get(view.componentId) ?? view.part2.defaultEnabled)
        );
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
        this.applyRPlusPresentation();
        this.applyDecorationPresentation();
        this.applyBackgroundPresentation();

        for (const diagnostic of applicationResult.diagnostics)
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        this.hierarchy.update(this.state);
        this.synchronizeParticleActivation();

        for (const diagnostic of this.puppet2dSplineSolver.solve())
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        for (const diagnostic of this.puppet2dIkSolver.solve())
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        for (const diagnostic of this.updateParticleSimulationFrames())
            AnimatorRuntimeUtils.appendUniqueString(diagnostics, diagnosticKeys, diagnostic);

        this.meshDeformer.update();
        this.spriteProjector.update();

        for (const simulator of this.particleSimulatorsById.values())
            simulator.advance(deltaSeconds);

        return { diagnostics };
    }

    reset(): AnimatorRuntimeFrameResult {
        this.particleActiveStates.clear();

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

    setRPlusEnabled(enabled: boolean): AnimatorRuntimeFrameResult {
        if (enabled && !this.hasRPlusPresentation)
            throw new Error("This Animator skin does not contain an R+ presentation.");

        this.rPlusEnabled = enabled;

        return this.advance(0);
    }

    setDecorationEnabled(group: 1 | 2, enabled: boolean): AnimatorRuntimeFrameResult {
        const partsViews = this.manifest.scene.interactions.partsViews;
        const matchingViews = partsViews.filter((view) =>
            this.hasPartGroupObjects(group === 1
                    ? view.part1
                    : view.part2
            )
        );

        if (matchingViews.length === 0)
            throw new Error(`This Animator skin has no decoration set ${group}.`);

        const states = group === 1
            ? this.decoration1States
            : this.decoration2States;

        for (const view of matchingViews)
            states.set(view.componentId, enabled);

        return this.advance(0);
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

    private applyRPlusPresentation() {
        const rplus = this.manifest.scene.interactions.rplus;

        for (const switcher of rplus.materialSwitchers)
        {
            for (const binding of switcher.bindings)
            {
                const textureId = this.rPlusEnabled
                    ? binding.rplusTextureId
                    : binding.originTextureId;

                if (!textureId)
                    continue;

                this.state.setMaterialTextureOverride(
                    binding.rendererId,
                    "SkinnedMeshRenderer",
                    binding.materialIndex,
                    binding.texturePropertyName,
                    textureId
                );
            }
        }

        for (const switcher of rplus.spriteSwitchers)
        {
            for (const binding of switcher.bindings)
            {
                const spriteId = this.rPlusEnabled
                    ? binding.rplusSpriteId
                    : binding.originSpriteId;

                if (!spriteId)
                    continue;

                this.state.requireSpriteRenderer(binding.rendererId).spriteId = spriteId;
            }
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

    private initializeDecorationStates() {
        const componentIds = new Set<string>();

        for (const view of this.manifest.scene.interactions.partsViews)
        {
            if (componentIds.has(view.componentId))
                throw new Error(`ActorPartsView "${view.componentId}" is duplicated.`);

            componentIds.add(view.componentId);

            this.validatePartGroup(view.componentId, "part 1", view.part1);
            this.validatePartGroup(view.componentId, "part 2", view.part2);

            this.decoration1States.set(view.componentId, view.part1.defaultEnabled);
            this.decoration2States.set(view.componentId, view.part2.defaultEnabled);

            this.validatePartGroup(view.componentId, "background", view.background);
            this.validateBackgroundTransforms(view.componentId, view.background);
        }
    }

    private validatePartGroup(
        componentId: string,
        groupName: string,
        group: Readonly<{
            enableObjectIds: readonly string[];
            disableObjectIds: readonly string[];
        }>
    ) {
        const objectIds = new Set<string>();

        for (const objectId of [...group.enableObjectIds, ...group.disableObjectIds]) {
            if (objectIds.has(objectId))
                throw new Error(`ActorPartsView "${componentId}" ${groupName} references GameObject "${objectId}" more than once.`);

            objectIds.add(objectId);
            this.state.requireGameObject(objectId);
        }
    }

    private validateBackgroundTransforms(componentId: string, background: AnimatorRuntimeBackgroundPartGroup) {
        const transformIds = new Set<string>();

        for (const change of background.transformChanges)
        {
            if (transformIds.has(change.transformId))
                throw new Error(`ActorPartsView "${componentId}" background references Transform "${change.transformId}" more than once.`);

            transformIds.add(change.transformId);
            this.state.requireTransform(change.transformId);

            AnimatorRuntimeUtils.requireFiniteVector(change.onPosition, 3, `ActorPartsView "${componentId}" background enabled position`);
            AnimatorRuntimeUtils.requireFiniteVector(change.onScale, 3, `ActorPartsView "${componentId}" background enabled scale`);
            AnimatorRuntimeUtils.requireFiniteVector(change.offPosition, 3, `ActorPartsView "${componentId}" background disabled position`);
            AnimatorRuntimeUtils.requireFiniteVector(change.offScale, 3, `ActorPartsView "${componentId}" background disabled scale`);
        }
    }

    private applyDecorationPresentation() {
        for (const view of this.manifest.scene.interactions.partsViews)
        {
            this.applyPartGroup(view.part1, this.decoration1States.get(view.componentId) ?? view.part1.defaultEnabled);
            this.applyPartGroup(view.part2, this.decoration2States.get(view.componentId) ?? view.part2.defaultEnabled);
        }
    }

    private applyBackgroundPresentation() {
        for (const view of this.manifest.scene.interactions.partsViews)
        {
            const background = view.background;

            this.applyPartGroup(background, true);

            for (const change of background.transformChanges)
            {
                const transform = this.state.requireTransform(change.transformId);

                AnimatorRuntimeUtils.copyFiniteVector(
                    transform.localPosition,
                    change.onPosition,
                    3,
                    `ActorPartsView "${view.componentId}" background position`
                );

                AnimatorRuntimeUtils.copyFiniteVector(
                    transform.localScale,
                    change.onScale,
                    3,
                    `ActorPartsView "${view.componentId}" background scale`
                );
            }
        }
    }

    private applyPartGroup(
        group: Readonly<{
            enableObjectIds: readonly string[];
            disableObjectIds: readonly string[];
        }>,
        enabled: boolean
    ) {
        for (const objectId of group.enableObjectIds)
            this.state.requireGameObject(objectId).active = enabled;

        for (const objectId of group.disableObjectIds)
            this.state.requireGameObject(objectId).active = !enabled;
    }

    private hasPartGroupObjects(
        group: Readonly<{
            enableObjectIds: readonly string[];
            disableObjectIds: readonly string[];
        }>
    ): boolean {
        return group.enableObjectIds.length > 0 || group.disableObjectIds.length > 0;
    }

    private indexTextures() {
        const textureIds = new Set<string>();
        const textureFiles = new Map<string, Readonly<{ sha256: string; width: number; height: number; }>>();

        for (const texture of this.manifest.textures)
        {
            if (textureIds.has(texture.id))
                throw new Error(`Texture "${texture.id}" is duplicated.`);
            if (!/^[0-9a-f]{64}$/i.test(texture.sha256) || texture.file !== `textures/${texture.sha256.toLowerCase()}.png`)
                throw new Error(`Texture "${texture.name}" has an invalid package path.`);
            if (!Number.isSafeInteger(texture.width) || !Number.isSafeInteger(texture.height) || texture.width <= 0 || texture.height <= 0)
                throw new Error(`Texture "${texture.name}" has invalid dimensions.`);

            const existingFile = textureFiles.get(texture.file);

            if (
                existingFile &&
                (
                    existingFile.sha256 !== texture.sha256.toLowerCase() ||
                    existingFile.width !== texture.width ||
                    existingFile.height !== texture.height
                )
            )
            {
                throw new Error(`Animator texture file "${texture.file}" has conflicting metadata.`);
            }

            textureIds.add(texture.id);

            if (!existingFile)
            {
                textureFiles.set(texture.file, {
                    sha256: texture.sha256.toLowerCase(),
                    width: texture.width,
                    height: texture.height
                });
            }

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
                throw new Error( `Sprite "${sprite.name}" references missing alpha texture "${sprite.alphaTextureId}".`);
        }
    }

    private updateParticleSimulationFrames(): readonly string[] {
        for (const simulator of this.particleSimulatorsById.values())
        {
            const transformId = this.hierarchy.requireTransformIdForGameObject(simulator.gameObjectId);
            const worldMatrix = this.hierarchy.requireParticleWorldMatrix(transformId, simulator.scalingMode);
            const worldRotation = this.hierarchy.requireWorldRotation(transformId);
            const gravity = this.rotateWorldVectorIntoLocal(worldRotation, 0, AnimatorRuntimePackage.WORLD_GRAVITY_Y, 0);

            simulator.setEmitterFrame(worldMatrix, gravity);
        }

        return [];
    }

    private synchronizeParticleActivation() {
        for (const simulator of this.particleSimulatorsById.values())
        {
            const active = this.hierarchy.isGameObjectActiveInHierarchy(simulator.gameObjectId);
            const previouslyActive = this.particleActiveStates.get(simulator.particleSystemId);

            this.particleActiveStates.set(simulator.particleSystemId, active);

            if (!active)
            {
                if (previouslyActive !== false)
                    simulator.stop(true);

                continue;
            }

            if (previouslyActive === false && simulator.definition.playOnAwake)
                simulator.reset();
        }
    }

    private rotateWorldVectorIntoLocal(worldRotation: readonly number[], worldX: number, worldY: number, worldZ: number): { x: number; y: number; z: number; } {
        AnimatorRuntimeUtils.requireFiniteVector(worldRotation, 4, "Particle-system world rotation");

        const x = -worldRotation[0];
        const y = -worldRotation[1];
        const z = -worldRotation[2];
        const w = worldRotation[3];

        const dot = (x * worldX) + (y * worldY) + (z * worldZ);
        const vectorScale = (w * w) - (x * x) - (y * y) - (z * z);

        return {
            x: (2 * dot * x) + (vectorScale * worldX) + (2 * w * ((y * worldZ) - (z * worldY))),
            y: (2 * dot * y) + (vectorScale * worldY) + (2 * w * ((z * worldX) - (x * worldZ))),
            z: (2 * dot * z) + (vectorScale * worldZ) + (2 * w * ((x * worldY) - (y * worldX)))
        };
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
        const wrapModeU = AnimatorRuntimePackage.parseTextureWrapMode(texture.wrapModeU, `Animator texture ${index} U wrap mode`);
        const wrapModeV = AnimatorRuntimePackage.parseTextureWrapMode(texture.wrapModeV, `Animator texture ${index} V wrap mode`);

        return {
            id,
            name,
            assetName,
            file,
            sha256,
            width,
            height,
            wrapModeU,
            wrapModeV
        };
    }

    private static parseTextureWrapMode(value: unknown, context: string): AnimatorRuntimeTextureWrapMode {
        const mode = AnimatorRuntimePackage.requireSafeInteger(value, context);
        if (mode !== 0 && mode !== 1 && mode !== 2 && mode !== 3)
            throw new Error(`${context} is unsupported.`);

        return mode;
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
