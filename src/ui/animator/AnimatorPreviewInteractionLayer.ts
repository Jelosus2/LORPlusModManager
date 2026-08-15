import type { AnimatorRuntimeHitbox } from "./AnimatorBindingResolver";
import type { AnimatorRuntimePackage } from "./AnimatorRuntimePackage";

import { Container, Graphics, Polygon } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type AnimatorPreviewInteractionKind =
    | "touch"
    | "special";

type AnimatorPreviewInteractionOptions = Readonly<{
    wasDragged: () => boolean;
    onTriggered?: (kind: AnimatorPreviewInteractionKind) => void;
}>;

type ProjectedPoint = Readonly<{
    x: number;
    y: number;
}>;

type AnimatorHitboxView = Readonly<{
    definition: AnimatorRuntimeHitbox;
    kind: AnimatorPreviewInteractionKind;
    root: Container;
    graphic: Graphics;
    color: number;
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

            this.updateHitboxGeometry(view, world);
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

        const graphic = new Graphics();
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
            kind,
            root,
            graphic,
            color
        });
    }

    private validateHitbox(hitbox: AnimatorRuntimeHitbox) {
        const requiredDimensions = hitbox.type === "BoxCollider"
            ? 3
            : 2;

        if (hitbox.center.length < requiredDimensions || hitbox.size.length < requiredDimensions)
            throw new Error(`Animator hitbox "${hitbox.id}" has invalid geometry.`);

        let positiveDimensions = 0;

        for (let i = 0; i < requiredDimensions; i++)
        {
            const center = hitbox.center[i];
            const size = hitbox.size[i];

            if (!Number.isFinite(center) || !Number.isFinite(size) || size < 0)
                throw new Error(`Animator hitbox "${hitbox.id}" has invalid geometry.`);

            if (size > 0)
                positiveDimensions++;
        }

        if (positiveDimensions < 2)
            throw new Error(`Animator hitbox "${hitbox.id}" has invalid geometry.`);
    }

    private updateHitboxGeometry(view: AnimatorHitboxView, world: ArrayLike<number>) {
        const hull = this.projectHitbox(view.definition, world);
        if (hull.length < 3)
            throw new Error(`Animator hitbox "${view.definition.id}" has a degenerate projection.`);

        const points = hull.flatMap((point) => [point.x, point.y]);

        view.graphic
            .clear()
            .poly(points, true)
            .fill({ color: view.color, alpha: view.kind === "special" ? 0.14 : 0.09 })
            .stroke({ color: view.color, alpha: 0.95, width: 1, pixelLine: true });

        view.graphic.hitArea = new Polygon(points);
    }

    private projectHitbox(hitbox: AnimatorRuntimeHitbox, world: ArrayLike<number>): readonly ProjectedPoint[] {
        const centerX = hitbox.center[0];
        const centerY = hitbox.center[1];
        const centerZ = hitbox.type === "BoxCollider"
            ? hitbox.center[2]
            : 0;

        const halfX = hitbox.size[0] / 2;
        const halfY = hitbox.size[1] / 2;
        const halfZ = hitbox.type === "BoxCollider"
            ? hitbox.size[2] / 2
            : 0;

        const zSigns = hitbox.type === "BoxCollider"
            ? [-1, 1]
            : [0];

        const projected: ProjectedPoint[] = [];

        for (const xSign of [-1, 1])
        {
            for (const ySign of [-1, 1])
            {
                for (const zSign of zSigns)
                {
                    const x = centerX + halfX * xSign;
                    const y = centerY + halfY * ySign;
                    const z = centerZ + halfZ * zSign;

                    projected.push({
                        x: world[0] * x + world[1] * y + world[2] * z + world[3],
                        y: world[4] * x + world[5] * y + world[6] * z + world[7]
                    });
                }
            }
        }

        return this.createConvexHull(projected);
    }

    private createConvexHull(points: readonly ProjectedPoint[]): readonly ProjectedPoint[] {
        const sorted = [...points].sort((left, right) =>
            left.x === right.x
                ? left.y - right.y
                : left.x - right.x
        );

        const unique = sorted.filter((point, index) => index === 0 || point.x !== sorted[index - 1].x || point.y !== sorted[index - 1].y);
        if (unique.length <= 2)
            return unique;

        const cross = (origin: ProjectedPoint, first: ProjectedPoint, second: ProjectedPoint) => (
            (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
        );

        const lower: ProjectedPoint[] = [];

        for (const point of unique)
        {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0)
                lower.pop();

            lower.push(point);
        }

        const upper: ProjectedPoint[] = [];

        for (let i = unique.length - 1; i >= 0; i--)
        {
            const point = unique[i];

            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0)
                upper.pop();

            upper.push(point);
        }

        lower.pop();
        upper.pop();

        return [...lower, ...upper];
    }
}
