import type { PreparedAnimatorSpriteMesh, PreparedAnimatorSprite, AnimatorPreparedGeometry } from "./AnimatorPreparedGeometry";
import type { AnimatorRuntimeScene, AnimatorRuntimeSprite } from "./AnimatorBindingResolver";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import type { PreparedAnimatorSpriteRenderer } from "./AnimatorRendererModel";
import type { AnimatorSceneState } from "./AnimatorSceneState";

import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export class AnimatorProjectedSpriteRenderer {
    private readonly runtimeSpritesById: ReadonlyMap<string, AnimatorRuntimeSprite>;
    private currentSpriteId: string | null = null;
    sprite: PreparedAnimatorSprite | null = null;
    textureId: string | null = null;
    positions2d = new Float32Array();
    uv0: Float32Array | null = null;
    indices: Uint32Array<ArrayBufferLike> = new Uint32Array();
    geometryRevision = 0;
    visible = false;

    constructor(
        readonly renderer: PreparedAnimatorSpriteRenderer,
        runtimeSpritesById: ReadonlyMap<string, AnimatorRuntimeSprite>,
        private readonly geometry: AnimatorPreparedGeometry,
        private readonly state: AnimatorSceneState,
        private readonly hierarchy: AnimatorTransformHierarchy
    ) {
        this.runtimeSpritesById = runtimeSpritesById;
    }

    update() {
        const rendererState = this.state.requireSpriteRenderer(this.renderer.id);

        if (rendererState.spriteId !== this.currentSpriteId)
            this.setSprite(rendererState.spriteId);

        this.visible =
            rendererState.enabled &&
            this.hierarchy.isGameObjectActiveInHierarchy(this.renderer.gameObjectId) &&
            this.sprite !== null &&
            this.textureId !== null &&
            this.positions2d.length > 0;

        if (!this.visible)
            return;

        const mesh = this.requireSpriteMesh();
        const worldMatrix = this.hierarchy.requireWorldMatrix(this.renderer.transformId);
        const flipX = rendererState.flipX ? -1 : 1;
        const flipY = rendererState.flipY ? -1 : 1;

        for (let vertexOffset = 0; vertexOffset < mesh.positions.length; vertexOffset += 2)
        {
            const x = mesh.positions[vertexOffset] * flipX;
            const y = mesh.positions[vertexOffset + 1] * flipY;

            this.positions2d[vertexOffset] = worldMatrix[0] * x + worldMatrix[1] * y + worldMatrix[3];
            this.positions2d[vertexOffset + 1] = worldMatrix[4] * x + worldMatrix[5] * y + worldMatrix[7];
        }
    }

    private setSprite(spriteId: string | null) {
        this.currentSpriteId = spriteId;
        this.geometryRevision++;

        if (!spriteId)
        {
            this.clearSprite();
            return;
        }

        const runtimeSprite = this.runtimeSpritesById.get(spriteId);
        if (!runtimeSprite)
            throw new Error(`SpriteRenderer "${this.renderer.id}" references missing Sprite "${spriteId}".`);

        const preparedSprite = this.geometry.requireSprite(spriteId);
        const mesh = preparedSprite.mesh;

        if (!mesh)
            throw new Error(`Sprite "${preparedSprite.name}" has no renderable mesh.`);
        if (!mesh.uv0)
            throw new Error(`Sprite "${preparedSprite.name}" has no texture coordinates.`);
        if (!runtimeSprite.textureId)
            throw new Error(`Sprite "${preparedSprite.name}" has no texture.`);

        this.sprite = preparedSprite;
        this.textureId = runtimeSprite.textureId;
        this.positions2d = new Float32Array(mesh.positions.length);
        this.uv0 = mesh.uv0;
        this.indices = mesh.indices;
    }

    private clearSprite() {
        this.sprite = null;
        this.textureId = null;
        this.positions2d = new Float32Array();
        this.uv0 = null;
        this.indices = new Uint32Array();
    }

    private requireSpriteMesh(): PreparedAnimatorSpriteMesh {
        const mesh = this.sprite?.mesh;
        if (!mesh)
            throw new Error(`SpriteRenderer "${this.renderer.id}" has no prepared Sprite mesh.`);

        return mesh;
    }
}

export class AnimatorSpriteProjector {
    readonly renderers = new Map<string, AnimatorProjectedSpriteRenderer>();

    constructor(
        scene: AnimatorRuntimeScene,
        renderers: readonly PreparedAnimatorSpriteRenderer[],
        geometry: AnimatorPreparedGeometry,
        state: AnimatorSceneState,
        hierarchy: AnimatorTransformHierarchy
    ) {
        const runtimeSpritesById = AnimatorRuntimeUtils.indexUniqueById(scene.sprites, "Sprite");

        for (const renderer of renderers)
        {
            if (this.renderers.has(renderer.id))
                throw new Error(`SpriteRenderer "${renderer.id}" has multiple sprite projectors.`);

            this.renderers.set(renderer.id, new AnimatorProjectedSpriteRenderer(renderer, runtimeSpritesById, geometry, state, hierarchy));
        }
    }

    update() {
        for (const renderer of this.renderers.values())
            renderer.update();
    }

    require(rendererId: string): AnimatorProjectedSpriteRenderer {
        const renderer = this.renderers.get(rendererId);

        if (!renderer)
            throw new Error(`SpriteRenderer "${rendererId}" has no sprite projector.`);

        return renderer;
    }
}
