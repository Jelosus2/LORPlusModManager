import type { PreparedAnimatorParticleRenderer } from "./AnimatorParticleRendererModel";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import type { AnimatorParticleSnapshot, AnimatorParticleVector3 } from "./AnimatorParticleSimulator";
import type { AnimatorRuntimeMaterial } from "./AnimatorBindingResolver";

import { Container, Matrix, Rectangle, Sprite, Texture } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

type ParticleMaterialColor = Readonly<{
    red: number;
    green: number;
    blue: number;
    alpha: number;
}>;

export class AnimatorPixiParticleView {
    private readonly spritesByParticleId = new Map<number, Sprite>();
    private readonly availableSprites: Sprite[] = [];
    private readonly frameTextures: readonly Texture[];
    private readonly ownsFrameTextures: boolean;
    private readonly particleMatrix = new Matrix();
    private readonly materialColor: ParticleMaterialColor;
    private destroyed = false;
    readonly root = new Container();

    constructor(readonly renderer: PreparedAnimatorParticleRenderer, texture: Texture, private readonly hierarchy: AnimatorTransformHierarchy) {
        this.root.sortableChildren = false;
        this.root.eventMode = "none";

        const frames = this.createFrameTextures(texture);

        this.frameTextures = frames.textures;
        this.ownsFrameTextures = frames.ownsTextures;
        this.materialColor = this.resolveMaterialColor(renderer.material);
    }

    update(zIndex: number) {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi particle view");

        this.root.zIndex = zIndex;

        const active = this.renderer.enabled && this.hierarchy.isActiveInHierarchy(this.renderer.transformId);

        if (!active)
        {
            this.releaseAllSprites();
            this.root.visible = false;
            return;
        }

        const particles = this.renderer.simulator.getParticles();

        this.root.visible = particles.length > 0 && this.materialColor.alpha > 0;
        this.synchronizeSprites(particles);
    }

    destroy() {
        if (this.destroyed)
            return;

        this.destroyed = true;

        this.spritesByParticleId.clear();
        this.availableSprites.length = 0;

        this.root.parent?.removeChild(this.root);
        this.root.destroy({ children: true });

        if (!this.ownsFrameTextures)
            return;

        for (const texture of this.frameTextures)
            texture.destroy(false);
    }

    private synchronizeSprites(particles: readonly AnimatorParticleSnapshot[]) {
        const activeIds = new Set<number>();

        for (const particle of particles)
        {
            activeIds.add(particle.id);

            const sprite = this.spritesByParticleId.get(particle.id) ?? this.acquireSprite(particle.id);
            this.updateSprite(sprite, particle);
        }

        for (const [particleId, sprite] of this.spritesByParticleId)
        {
            if (activeIds.has(particleId))
                continue;

            this.releaseSprite(particleId, sprite);
        }
    }

    private acquireSprite(particleId: number): Sprite {
        const sprite = this.availableSprites.pop() ?? this.createSprite();

        sprite.visible = true;
        this.spritesByParticleId.set(particleId, sprite);

        return sprite;
    }

    private createSprite(): Sprite {
        const sprite = new Sprite({
            texture: this.frameTextures[0],
            anchor: {
                x: 0.5 - this.renderer.pivot[0],
                y: 0.5 - this.renderer.pivot[1]
            }
        });

        sprite.eventMode = "none";
        this.root.addChild(sprite);

        return sprite;
    }

    private updateSprite(sprite: Sprite, particle: AnimatorParticleSnapshot) {
        const texture = this.resolveFrameTexture(particle.textureFrame);

        if (sprite.texture !== texture)
            sprite.texture = texture;

        const alpha = this.clamp01(particle.color.a * this.materialColor.alpha);
        const red = this.clamp01(particle.color.r * this.materialColor.red);
        const green = this.clamp01(particle.color.g * this.materialColor.green);
        const blue = this.clamp01(particle.color.b * this.materialColor.blue);

        const flipX = this.shouldFlip(particle.randomSeed, 0x68bc21eb, this.renderer.flip[0])
            ? -1
            : 1;

        const flipY = this.shouldFlip(particle.randomSeed, 0x02e5be93, this.renderer.flip[1])
            ? -1
            : 1;

        this.updateSpriteTransform(sprite, particle, texture, flipX, flipY);

        sprite.tint =
            (Math.round(red * 255) << 16) |
            (Math.round(green * 255) << 8) |
            Math.round(blue * 255);

        sprite.alpha = alpha;
        sprite.visible = particle.size > 0 && alpha > 0;
    }

    private updateSpriteTransform(sprite: Sprite, particle: AnimatorParticleSnapshot, texture: Texture, flipX: number, flipY: number) {
        const world = this.hierarchy.requireWorldMatrix(this.renderer.transformId);
        const horizontal = this.rotateParticleAxis(1, 0, 0, particle.rotation);
        const vertical = this.rotateParticleAxis(0, 1, 0, particle.rotation);
        const horizontalScale = flipX * particle.size / texture.width;
        const verticalScale = -flipY * particle.size / texture.height;

        const a = (
            world[0] * horizontal.x +
            world[1] * horizontal.y +
            world[2] * horizontal.z
        ) * horizontalScale;

        const b = (
            world[4] * horizontal.x +
            world[5] * horizontal.y +
            world[6] * horizontal.z
        ) * horizontalScale;

        const c = (
            world[0] * vertical.x +
            world[1] * vertical.y +
            world[2] * vertical.z
        ) * verticalScale;

        const d = (
            world[4] * vertical.x +
            world[5] * vertical.y +
            world[6] * vertical.z
        ) * verticalScale;

        const x =
            world[0] * particle.position.x +
            world[1] * particle.position.y +
            world[2] * particle.position.z +
            world[3];

        const y =
            world[4] * particle.position.x +
            world[5] * particle.position.y +
            world[6] * particle.position.z +
            world[7];

        this.particleMatrix.set(a, b, c, d, x, y);
        sprite.setFromMatrix(this.particleMatrix);
    }

    private rotateParticleAxis(x: number, y: number, z: number, rotation: AnimatorParticleVector3): AnimatorParticleVector3 {
        const cosineZ = Math.cos(rotation.z);
        const sineZ = Math.sin(rotation.z);

        const afterZ = {
            x: x * cosineZ - y * sineZ,
            y: x * sineZ + y * cosineZ,
            z
        };

        const cosineX = Math.cos(rotation.x);
        const sineX = Math.sin(rotation.x);

        const afterX = {
            x: afterZ.x,
            y: afterZ.y * cosineX - afterZ.z * sineX,
            z: afterZ.y * sineX + afterZ.z * cosineX
        };

        const cosineY = Math.cos(rotation.y);
        const sineY = Math.sin(rotation.y);

        return {
            x: afterX.x * cosineY + afterX.z * sineY,
            y: afterX.y,
            z: -afterX.x * sineY + afterX.z * cosineY
        };
    }

    private releaseSprite(particleId: number, sprite: Sprite) {
        this.spritesByParticleId.delete(particleId);

        sprite.visible = false;
        sprite.alpha = 0;

        this.availableSprites.push(sprite);
    }

    private releaseAllSprites() {
        for (const [particleId, sprite] of this.spritesByParticleId)
            this.releaseSprite(particleId, sprite);
    }

    private resolveFrameTexture(frame: number): Texture {
        const index = Math.min(this.frameTextures.length - 1, Math.max(0, Math.floor(frame)));
        return this.frameTextures[index];
    }

    private createFrameTextures(texture: Texture): Readonly<{ textures: readonly Texture[]; ownsTextures: boolean; }> {
        const sheet = this.renderer.simulator.textureSheet;
        const frameCount = sheet.columns * sheet.rows;

        if (frameCount === 1)
        {
            return {
                textures: Object.freeze([texture]),
                ownsTextures: false
            };
        }

        const sourceFrame = texture.frame;
        const frameWidth = sourceFrame.width / sheet.columns;
        const frameHeight = sourceFrame.height / sheet.rows;
        const textures: Texture[] = [];

        for (let frame = 0; frame < frameCount; frame++)
        {
            const column = frame % sheet.columns;
            const row = Math.floor(frame / sheet.columns);

            textures.push(new Texture({
                source: texture.source,
                frame: new Rectangle(sourceFrame.x + column * frameWidth, sourceFrame.y + row * frameHeight, frameWidth, frameHeight),
                orig: new Rectangle(0, 0, frameWidth, frameHeight)
            }));
        }

        return {
            textures: Object.freeze(textures),
            ownsTextures: true
        };
    }

    private resolveMaterialColor(material: AnimatorRuntimeMaterial): ParticleMaterialColor {
        const color = {
            red: 1,
            green: 1,
            blue: 1,
            alpha: 1
        };

        for (const propertyName of ["_Color", "_TintColor", "_RendererColor"])
        {
            const value = material.colorProperties.find((property) => property.name === propertyName)?.value;
            if (!value || value.length !== 4)
                continue;

            color.red *= value[0] ?? 1;
            color.green *= value[1] ?? 1;
            color.blue *= value[2] ?? 1;
            color.alpha *= value[3] ?? 1;
        }

        return Object.freeze(color);
    }

    private shouldFlip(seed: number, salt: number, probability: number): boolean {
        if (probability <= 0)
            return false;
        if (probability >= 1)
            return true;

        let value = (seed ^ salt) >>> 0;

        value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
        value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
        value = (value ^ (value >>> 16)) >>> 0;

        return value / 0x1_0000_0000 < probability;
    }

    private clamp01(value: number): number {
        if (!Number.isFinite(value))
            return 0;

        return Math.min(1, Math.max(0, value));
    }
}
