import type { AnimatorRuntimeHitbox } from "./AnimatorBindingResolver";
import type { AnimatorRuntimePackage } from "./AnimatorRuntimePackage";

import { Container, Graphics, Matrix, Rectangle } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type AnimatorPreviewInteractionKind =
    | "touch"
    | "special";

type AnimatorPreviewInteractionOptions = Readonly<{
    wasDragged: () => boolean;
    onTriggered?: (kind: AnimatorPreviewInteractionKind) => void;
}>;

type AnimatorHitboxView = Readonly<{
    definition: AnimatorRuntimeHitbox;
    root: Container;
    graphic: Graphics;
    matrix: Matrix;
}>;

export class AnimatorPreviewInteractionLayer {
    private static readonly TRIGGER_PARAMETERS = {
        touch: "Tep_1",
        special: "breast"
    };
    private readonly views: AnimatorHitboxView[] = [];
    private destroyed = false;
    readonly root = new Container();

    constructor(private readonly runtime: AnimatorRuntimePackage, private readonly options: AnimatorPreviewInteractionOptions) {
        this.root.sortableChildren = true;
        this.root.zIndex = 1_000_000;
        this.root.alpha = 0;

        const hitboxes = runtime.manifest.scene.interactions.actor.hitboxes;

        if (hitboxes.touch && runtime.hasTriggerParameter(AnimatorPreviewInteractionLayer.TRIGGER_PARAMETERS.touch))
            this.addHitbox(hitboxes.touch, "touch");

        if (runtime.hasTriggerParameter(AnimatorPreviewInteractionLayer.TRIGGER_PARAMETERS.special))
        {
            for (const hitbox of hitboxes.specialTouch)
                this.addHitbox(hitbox, "special");
        }

        this.update();
    }

    get hasHitboxes(): boolean {
        return this.views.length > 0;
    }

    update() {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator interaction layer");

        for (const view of this.views)
        {
            const active = view.definition.enabled && this.runtime.hierarchy.isGameObjectActiveInHierarchy(view.definition.gameObjectId);

            view.root.visible = active;
            view.graphic.eventMode = active
                ? "static"
                : "none";

            if (!active)
                continue;

            const world = this.runtime.hierarchy.requireWorldMatrixForGameObject(view.definition.gameObjectId);

            view.matrix.set(world[0], world[4], world[1], world[5], world[3], world[7]);
            view.root.setFromMatrix(view.matrix);
        }
    }

    destroy() {
        if (this.destroyed)
            return;

        this.destroyed = true;
        this.views.length = 0;

        this.root.parent?.removeChild(this.root);
        this.root.destroy({ children: true });
    }

    setOutlinesVisible(visible: boolean) {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator interaction layer");
        this.root.alpha = visible ? 1 : 0;
    }

    private addHitbox(hitbox: AnimatorRuntimeHitbox, kind: AnimatorPreviewInteractionKind) {
        this.validateHitbox(hitbox);

        const color = kind === "special" ? 0xe5a06d  : 0x91b8cf;
        const x = hitbox.center[0] - hitbox.size[0] / 2;
        const y = hitbox.center[1] - hitbox.size[1] / 2;
        const width = hitbox.size[0];
        const height = hitbox.size[1];

        const graphic = new Graphics()
            .rect(x, y, width, height)
            .fill({ color, alpha: kind === "special" ? 0.14 : 0.09 })
            .stroke({ color, alpha: 0.95, width: 1, pixelLine: true });

        graphic.hitArea = new Rectangle(x, y, width, height);
        graphic.eventMode = "static";
        graphic.cursor = "pointer";

        graphic.on("pointertap", (event) => {
            event.stopPropagation();

            if (this.options.wasDragged())
                return;

            const triggerCount = this.runtime.triggerParameter(AnimatorPreviewInteractionLayer.TRIGGER_PARAMETERS[kind]);
            if (triggerCount > 0)
                this.options.onTriggered?.(kind);
        });

        const root = new Container();

        root.zIndex = kind === "special" ? 1 : 0;
        root.addChild(graphic);

        this.root.addChild(root);

        this.views.push({
            definition: hitbox,
            root,
            graphic,
            matrix: new Matrix()
        });
    }

    private validateHitbox(hitbox: AnimatorRuntimeHitbox) {
        if (
            hitbox.center.length < 2 ||
            hitbox.size.length < 2 ||
            !Number.isFinite(hitbox.center[0]) ||
            !Number.isFinite(hitbox.center[1]) ||
            !Number.isFinite(hitbox.size[0]) ||
            !Number.isFinite(hitbox.size[1]) ||
            hitbox.size[0] <= 0 ||
            hitbox.size[1] <= 0
        )
        {
            throw new Error(`Animator hitbox "${hitbox.id}" has invalid geometry.`);
        }
    }
}
