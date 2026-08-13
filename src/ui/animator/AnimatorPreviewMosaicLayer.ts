import type { AnimatorProjectedSpriteRenderer } from "./AnimatorSpriteProjector";
import type { AnimatorRuntimeMosaic } from "./AnimatorBindingResolver";
import type { AnimatorRuntimePackage } from "./AnimatorRuntimePackage";

import { AnimatorPixiScene, type AnimatorPixiFaceAsset } from "./AnimatorPixiScene";
import { Container, Mesh, MeshGeometry, Texture } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";
import { PixelateFilter } from "pixi-filters/pixelate";

type AnimatorMosaicMaskView = {
    definition: AnimatorRuntimeMosaic;
    projector: AnimatorProjectedSpriteRenderer;
    display: Mesh<MeshGeometry> | null;
    geometry: MeshGeometry | null;
    geometryRevision: number;
};

export class AnimatorPreviewMosaicLayer {
    private readonly PIXEL_SIZE = 12;
    private readonly Z_INDEX = 999_000;
    private readonly pixelatedScene: AnimatorPixiScene;
    private readonly maskRoot = new Container();
    private readonly pixelateFilter = new PixelateFilter(this.PIXEL_SIZE);
    private readonly maskViews: AnimatorMosaicMaskView[] = [];
    private destroyed = false;
    readonly root = new Container();
    readonly hasPresentation: boolean;

    constructor(
        private readonly runtime: AnimatorRuntimePackage,
        private readonly texturesById: ReadonlyMap<string, Texture>,
        faceAssets: readonly AnimatorPixiFaceAsset[] = []
    ) {
        this.root.sortableChildren = true;
        this.root.eventMode = "none";
        this.root.zIndex = this.Z_INDEX;
        this.root.visible = false;

        this.pixelatedScene = new AnimatorPixiScene(runtime, texturesById, {
            includeParticles: false,
            faceAssets
        });

        this.pixelatedScene.root.scale.set(1, 1);
        this.pixelatedScene.root.eventMode = "none";
        this.pixelatedScene.root.zIndex = 0;
        this.pixelatedScene.root.filters = [this.pixelateFilter];

        this.maskRoot.eventMode = "none";
        this.maskRoot.zIndex = 1;

        this.pixelatedScene.root.mask = this.maskRoot;

        this.root.addChild(this.pixelatedScene.root, this.maskRoot);

        this.createMaskViews();

        this.hasPresentation = runtime.hasRPlusPresentation && this.maskViews.some((view) => view.display !== null);
    }

    update() {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator mosaic layer");

        if (!this.root.visible)
            return;

        this.pixelatedScene.refreshViews();

        for (const view of this.maskViews)
            this.updateMaskView(view);
    }

    setVisible(visible: boolean) {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator mosaic layer");

        this.root.visible = visible && this.hasPresentation;

        if (this.root.visible)
            this.update();
    }

    setFace(assetName: string | null) {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator mosaic layer");
        this.pixelatedScene.setFace(assetName);
    }

    destroy() {
        if (this.destroyed)
            return;

        this.destroyed = true;
        this.root.visible = false;

        this.pixelatedScene.root.mask = null;
        this.pixelatedScene.root.filters = null;

        this.pixelatedScene.destroy();
        this.pixelateFilter.destroy();

        for (const view of this.maskViews)
            this.destroyMaskGeometry(view);

        this.maskViews.length = 0;

        this.maskRoot.parent?.removeChild(this.maskRoot);
        this.maskRoot.destroy({ children: false });

        this.root.parent?.removeChild(this.root);
        this.root.destroy({ children: false });
    }

    private createMaskViews() {
        for (const definition of this.runtime.manifest.scene.interactions.mosaics)
        {
            if (!definition.enabled)
                continue;

            const view: AnimatorMosaicMaskView = {
                definition,
                projector: this.runtime.spriteProjector.require(definition.rendererId),
                display: null,
                geometry: null,
                geometryRevision: -1
            };

            this.maskViews.push(view);
            this.updateMaskView(view);
        }
    }

    private updateMaskView(view: AnimatorMosaicMaskView) {
        const hasProjection = view.projector.projectGeometryIgnoringHierarchy();

        if (view.geometryRevision !== view.projector.geometryRevision)
            this.rebuildMaskGeometry(view);

        if (!view.display || !view.geometry)
            return;

        view.display.visible = view.definition.enabled && hasProjection;
        if (!view.display.visible)
            return;

        view.geometry.positions.set(view.projector.positions2d);
        view.geometry.getBuffer("aPosition").update();
    }

    private rebuildMaskGeometry(view: AnimatorMosaicMaskView) {
        this.destroyMaskGeometry(view);

        view.geometryRevision = view.projector.geometryRevision;

        const textureId = view.projector.textureId;
        const uv0 = view.projector.uv0;

        if (!view.projector.sprite || !textureId || !uv0 || view.projector.positions2d.length === 0 || view.projector.indices.length === 0)
            return;

        const texture = this.texturesById.get(textureId);
        if (!texture)
            throw new Error(`Mosaic Sprite "${view.projector.sprite.name}" references unavailable texture "${textureId}".`);

        const geometry = new MeshGeometry({
            positions: new Float32Array(view.projector.positions2d),
            uvs: AnimatorRuntimeUtils.createTextureCoordinates(uv0),
            indices: new Uint32Array(view.projector.indices),
            shrinkBuffersToFit: false
        });

        geometry.batchMode = "no-batch";

        const display = new Mesh({
            geometry,
            texture
        });

        display.eventMode = "none";

        view.geometry = geometry;
        view.display = display;

        this.maskRoot.addChild(display);
    }

    private destroyMaskGeometry(view: AnimatorMosaicMaskView) {
        if (view.display)
        {
            view.display.parent?.removeChild(view.display);
            view.display.destroy();
            view.display = null;
        }

        if (view.geometry)
        {
            view.geometry.destroy(true);
            view.geometry = null;
        }
    }
}
