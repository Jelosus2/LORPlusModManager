import type { AnimatorRuntimeParticleSystemRenderer, AnimatorRuntimeMaterial, AnimatorRuntimeScene } from "./AnimatorBindingResolver";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";

import { AnimatorParticleSimulator } from "./AnimatorParticleSimulator";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type PreparedAnimatorParticleRenderer = Readonly<{
    id: string;
    gameObjectId: string;
    transformId: string;
    enabled: boolean;
    sourceOrder: number;
    sortingLayerId: number;
    sortingOrder: number;
    materialId: string;
    textureId: string;
    material: AnimatorRuntimeMaterial;
    simulator: AnimatorParticleSimulator;
    minimumParticleSize: number;
    maximumParticleSize: number;
    pivot: readonly number[];
    flip: readonly number[];
}>;

export class AnimatorParticleRendererModel {
    readonly renderers: readonly PreparedAnimatorParticleRenderer[];
    readonly diagnostics: readonly string[];

    constructor(scene: AnimatorRuntimeScene, simulatorsById: ReadonlyMap<string, AnimatorParticleSimulator>, hierarchy: AnimatorTransformHierarchy) {
        const materialsById = AnimatorRuntimeUtils.indexUniqueById(scene.materials, "Material");
        const particleSystemsById = AnimatorRuntimeUtils.indexUniqueById(scene.particleSystems, "ParticleSystem");
        const rendererIds = new Set<string>();
        const referencedParticleSystemIds = new Set<string>();
        const renderers: PreparedAnimatorParticleRenderer[] = [];
        const diagnostics: string[] = [];

        for (const [sourceOrder, renderer] of scene.particleSystemRenderers.entries())
        {
            if (!renderer.id)
                throw new Error("A ParticleSystemRenderer has no ID.");
            if (rendererIds.has(renderer.id))
                throw new Error(`ParticleSystemRenderer "${renderer.id}" is duplicated.`);

            rendererIds.add(renderer.id);

            const definition = particleSystemsById.get(renderer.particleSystemId);

            if (!definition)
            {
                diagnostics.push(`ParticleSystemRenderer "${renderer.id}" references missing ParticleSystem "${renderer.particleSystemId}".`);
                continue;
            }

            if (referencedParticleSystemIds.has(definition.id))
            {
                diagnostics.push(`ParticleSystem "${definition.id}" has multiple renderers.`);
                continue;
            }

            referencedParticleSystemIds.add(definition.id);

            const simulator = simulatorsById.get(definition.id);
            if (!simulator)
                continue;

            try
            {
                renderers.push(this.prepareRenderer(renderer, simulator, sourceOrder, materialsById, hierarchy));
            }
            catch (error)
            {
                const reason = error instanceof Error
                    ? error.message
                    : "The particle renderer uses an unsupported configuration.";

                diagnostics.push(`ParticleSystemRenderer "${renderer.id}" could not be previewed. ${reason}`);
            }
        }

        for (const particleSystemId of simulatorsById.keys())
        {
            if (!referencedParticleSystemIds.has(particleSystemId))
                diagnostics.push(`ParticleSystem "${particleSystemId}" has no renderer.`);
        }

        this.renderers = Object.freeze(renderers);
        this.diagnostics = Object.freeze(diagnostics);
    }

    private prepareRenderer(
        renderer: AnimatorRuntimeParticleSystemRenderer,
        simulator: AnimatorParticleSimulator,
        sourceOrder: number,
        materialsById: ReadonlyMap<string, AnimatorRuntimeMaterial>,
        hierarchy: AnimatorTransformHierarchy
    ): PreparedAnimatorParticleRenderer {
        if (renderer.gameObjectId !== simulator.gameObjectId)
            throw new Error("Its ParticleSystem belongs to a different GameObject.");
        if (renderer.renderMode !== 0)
            throw new Error(`Render mode ${renderer.renderMode} is unsupported.`);
        if (renderer.sortMode !== 0)
            throw new Error(`Sort mode ${renderer.sortMode} is unsupported.`);
        if (renderer.renderAlignment !== 2)
            throw new Error(`Render alignment ${renderer.renderAlignment} is unsupported.`);
        if (renderer.materialIds.length !== 1)
            throw new Error("Exactly one particle material is required.");

        const materialId = renderer.materialIds[0];
        if (!materialId)
            throw new Error("Its particle material is missing.");

        const material = materialsById.get(materialId);
        if (!material)
            throw new Error(`Material "${materialId}" is missing.`);

        const textureProperty =
            material.textureProperties.find((property) => property.name === "_MainTex" && property.textureId !== null) ??
            material.textureProperties.find((property) => property.textureId !== null);

        if (!textureProperty?.textureId)
            throw new Error(`Material "${material.name}" has no texture.`);

        if (
            !Number.isFinite(renderer.minimumParticleSize) ||
            !Number.isFinite(renderer.maximumParticleSize) ||
            renderer.minimumParticleSize < 0 ||
            renderer.maximumParticleSize < renderer.minimumParticleSize
        )
        {
            throw new Error("Its particle-size limits are invalid.");
        }

        AnimatorRuntimeUtils.requireFiniteVector(renderer.pivot, 3, "Particle renderer pivot");
        AnimatorRuntimeUtils.requireFiniteVector(renderer.flip, 3, "Particle renderer flip");

        if (renderer.flip.some((value) => value < 0 || value > 1))
            throw new Error("Its particle flip probabilities are invalid.");

        return Object.freeze({
            id: renderer.id,
            gameObjectId: renderer.gameObjectId,
            transformId: hierarchy.requireTransformIdForGameObject(renderer.gameObjectId),
            enabled: renderer.enabled,
            sourceOrder,
            sortingLayerId: renderer.sortingLayerId,
            sortingOrder: renderer.sortingOrder,
            materialId,
            textureId: textureProperty.textureId,
            material,
            simulator,
            minimumParticleSize: renderer.minimumParticleSize,
            maximumParticleSize: renderer.maximumParticleSize,
            pivot: Object.freeze([...renderer.pivot]),
            flip: Object.freeze([...renderer.flip])
        });
    }
}
