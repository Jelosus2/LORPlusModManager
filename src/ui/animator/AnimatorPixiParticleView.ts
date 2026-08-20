import type { AnimatorParticleMaterialColor, AnimatorLegacyParticleShaderMode } from "./AnimatorLegacyAdditiveParticleShader";
import type { AnimatorParticleSnapshot, AnimatorParticleVector3 } from "./AnimatorParticleSimulator";
import type { PreparedAnimatorParticleRenderer } from "./AnimatorParticleRendererModel";
import type { AnimatorTransformHierarchy } from "./AnimatorTransformHierarchy";
import type { AnimatorRuntimeMaterial } from "./AnimatorBindingResolver";

import { AnimatorLegacyAdditiveParticleShader  } from "./AnimatorLegacyAdditiveParticleShader";
import { Container, Matrix, MeshGeometry, Mesh, Rectangle, Texture } from "pixi.js";
import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type AnimatorParticleViewState = Readonly<{
    enabled: boolean;
    zIndex: number;
    textureTransform: readonly number[];
}>;

type ParticleBillboardView = {
    display: Mesh<MeshGeometry>;
    additiveShader: AnimatorLegacyAdditiveParticleShader | null;
};

type ParticleMeshView = {
    display: Mesh<MeshGeometry>;
    geometry: MeshGeometry;
    positions: Float32Array;
    sourceUv0: Float32Array;
    textureTransformRevision: number;
    additiveShader: AnimatorLegacyAdditiveParticleShader | null;
};

export class AnimatorPixiParticleView {
    private readonly billboardViewsByParticleId = new Map<number, ParticleBillboardView>();
    private readonly availableBillboardViews: ParticleBillboardView[] = [];
    private readonly billboardGeometry: MeshGeometry | null;
    private readonly frameTextures: readonly Texture[];
    private readonly ownsFrameTextures: boolean;
    private readonly particleMatrix = new Matrix();
    private readonly materialColor: AnimatorParticleMaterialColor;
    private readonly meshViewsByParticleId = new Map<number, ParticleMeshView>();
    private readonly availableMeshViews: ParticleMeshView[] = [];
    private readonly legacyShaderMode: AnimatorLegacyParticleShaderMode | null;
    private textureScaleX = 1;
    private textureScaleY = 1;
    private textureOffsetX = 0;
    private textureOffsetY = 0;
    private textureTransformRevision = 0;
    private destroyed = false;
    readonly root = new Container();

    constructor(readonly renderer: PreparedAnimatorParticleRenderer, texture: Texture, private readonly hierarchy: AnimatorTransformHierarchy) {
        this.root.sortableChildren = false;
        this.root.eventMode = "none";

        const frames = this.createFrameTextures(texture);

        this.frameTextures = frames.textures;
        this.ownsFrameTextures = frames.ownsTextures;
        this.materialColor = this.resolveMaterialColor(renderer.material);
        this.legacyShaderMode = AnimatorLegacyAdditiveParticleShader.resolveAnimatorLegacyParticleShaderMode(renderer.material);
        this.billboardGeometry = renderer.renderMode === 4
            ? null
            : this.createBillboardGeometry();
    }

    update(state: AnimatorParticleViewState) {
        AnimatorRuntimeUtils.requireNotDestroyed(this.destroyed, "The Animator Pixi particle view");

        const transform = AnimatorRuntimeUtils.requireFiniteVector(
            state.textureTransform,
            4,
            `ParticleSystemRenderer "${this.renderer.id}" texture transform`
        );

        if (
            transform[0] !== this.textureScaleX ||
            transform[1] !== this.textureScaleY ||
            transform[2] !== this.textureOffsetX ||
            transform[3] !== this.textureOffsetY
        )
        {
            this.textureScaleX = transform[0];
            this.textureScaleY = transform[1];
            this.textureOffsetX = transform[2];
            this.textureOffsetY = transform[3];
            this.textureTransformRevision++;
        }

        this.root.zIndex = state.zIndex;

        const active = state.enabled && this.hierarchy.isActiveInHierarchy(this.renderer.transformId);

        if (!active)
        {
            this.releaseAllBillboardViews();
            this.releaseAllMeshViews();
            this.root.visible = false;
            return;
        }

        const particles = this.renderer.simulator.getParticles();

        this.root.visible = particles.length > 0 && this.materialColor.alpha > 0;

        if (this.renderer.renderMode === 4)
            this.synchronizeMeshViews(particles);
        else
            this.synchronizeBillboardViews(particles);
    }

    destroy() {
        if (this.destroyed)
            return;

        this.destroyed = true;

        this.destroyAllBillboardViews();
        this.destroyAllMeshViews();

        this.billboardGeometry?.destroy(true);

        this.root.parent?.removeChild(this.root);
        this.root.destroy({ children: true });

        if (!this.ownsFrameTextures)
            return;

        for (const texture of this.frameTextures)
            texture.destroy(false);
    }

    private synchronizeBillboardViews(particles: readonly AnimatorParticleSnapshot[]) {
        const activeIds = new Set<number>();

        for (const particle of particles)
        {
            activeIds.add(particle.id);

            const view = this.billboardViewsByParticleId.get(particle.id) ?? this.acquireBillboardView(particle.id);
            this.updateBillboardView(view, particle);
        }

        for (const [particleId, view] of this.billboardViewsByParticleId.entries())
        {
            if (!activeIds.has(particleId))
                this.releaseBillboardView(particleId, view);
        }
    }

    private synchronizeMeshViews(particles: readonly AnimatorParticleSnapshot[]) {
        const activeIds = new Set<number>();

        for (const particle of particles)
        {
            activeIds.add(particle.id);

            const view = this.meshViewsByParticleId.get(particle.id) ?? this.acquireMeshView(particle.id);
            this.updateMeshView(view, particle);
        }

        for (const [particleId, view] of this.meshViewsByParticleId)
        {
            if (!activeIds.has(particleId))
                this.releaseMeshView(particleId, view);
        }
    }

    private acquireBillboardView(particleId: number): ParticleBillboardView {
        const view = this.availableBillboardViews.pop() ?? this.createBillboardView();

        view.display.visible = true;
        this.billboardViewsByParticleId.set(particleId, view);

        return view;
    }

    private acquireMeshView(particleId: number): ParticleMeshView {
        const view = this.availableMeshViews.pop() ?? this.createMeshView();

        view.display.visible = true;
        this.meshViewsByParticleId.set(particleId, view);

        return view;
    }

    private createBillboardView(): ParticleBillboardView {
        if (!this.billboardGeometry)
            throw new Error(`ParticleSystemRenderer "${this.renderer.id}" has no billboard geometry.`);

        const texture = this.frameTextures[0];
        const additiveShader = this.legacyShaderMode
            ? new AnimatorLegacyAdditiveParticleShader(texture, this.materialColor, this.legacyShaderMode)
            : null;

        const display = new Mesh({
            geometry: this.billboardGeometry,
            texture,
            shader: additiveShader
        });

        display.blendMode = this.legacyShaderMode === "soft-additive"
            ? "screen"
            : this.renderer.blendMode;

        display.eventMode = "none";

        this.root.addChild(display);

        return {
            display,
            additiveShader
        };
    }

    private createBillboardGeometry(): MeshGeometry {
        const texture = this.frameTextures[0];
        const pivotX = this.renderer.pivot[0];
        const pivotY = this.renderer.pivot[1];

        const left = (-0.5 + pivotX) * texture.width;
        const top = (-0.5 - pivotY) * texture.height;
        const right = left + texture.width;
        const bottom = top + texture.height;

        const geometry = new MeshGeometry({
            positions: new Float32Array([
                left, top,
                right, top,
                right, bottom,
                left, bottom
            ]),
            uvs: new Float32Array([
                0, 0,
                1, 0,
                1, 1,
                0, 1
            ]),
            indices: new Uint32Array([
                0, 1, 2,
                0, 2, 3
            ]),
            shrinkBuffersToFit: false
        });

        if (this.renderer.blendMode === "add")
            geometry.batchMode = "no-batch";

        return geometry;
    }

    private createMeshView(): ParticleMeshView {
        const mesh = this.renderer.mesh;
        if (!mesh?.uv0)
            throw new Error(`ParticleSystemRenderer "${this.renderer.id}" has no prepared Mesh geometry.`);

        const submesh = mesh.submeshes[0];
        if (!submesh)
            throw new Error(`Particle Mesh "${mesh.name}" has no submesh.`);

        const positions = new Float32Array(mesh.vertexCount * 2);
        const sourceUv0 = AnimatorRuntimeUtils.createTextureCoordinates(mesh.uv0);

        const geometry = new MeshGeometry({
            positions,
            uvs: new Float32Array(sourceUv0),
            indices: new Uint32Array(submesh.indices),
            shrinkBuffersToFit: false
        });

        geometry.batchMode = "no-batch";

        const texture = this.frameTextures[0];
        const additiveShader = this.legacyShaderMode
            ? new AnimatorLegacyAdditiveParticleShader(texture, this.materialColor, this.legacyShaderMode)
            : null;

        const display = new Mesh({
            geometry,
            texture,
            shader: additiveShader
        });

        display.blendMode = this.legacyShaderMode === "soft-additive"
            ? "screen"
            : this.renderer.blendMode;

        display.eventMode = "none";
        this.root.addChild(display);

        return {
            display,
            geometry,
            positions,
            sourceUv0,
            textureTransformRevision: -1,
            additiveShader
        };
    }

    private updateMeshView(view: ParticleMeshView, particle: AnimatorParticleSnapshot) {
        const texture = this.resolveFrameTexture(particle.textureFrame);

        if (view.display.texture !== texture)
            view.display.texture = texture;

        this.updateMeshTextureCoordinates(view);

        const alpha = this.clamp01(particle.color.a * this.materialColor.alpha);
        const red = this.clamp01(particle.color.r * this.materialColor.red);
        const green = this.clamp01(particle.color.g * this.materialColor.green);
        const blue = this.clamp01(particle.color.b * this.materialColor.blue);
        const flipX = this.shouldFlip(particle.randomSeed, 0x68bc21eb, this.renderer.flip[0]) ? -1 : 1;
        const flipY = this.shouldFlip(particle.randomSeed, 0x02e5be93, this.renderer.flip[1]) ? -1 : 1;
        const flipZ = this.shouldFlip(particle.randomSeed, 0x51b24a91, this.renderer.flip[2]) ? -1 : 1;

        this.updateMeshGeometry(view, particle, flipX, flipY, flipZ);

        if (view.additiveShader)
        {
            view.additiveShader.setParticleColor(particle.color);
            view.display.tint = 0xffffff;
            view.display.alpha = 1;
        }
        else
        {
            view.display.tint =
                (Math.round(red * 255) << 16) |
                (Math.round(green * 255) << 8) |
                Math.round(blue * 255);

            view.display.alpha = alpha;
        }

        view.display.visible = particle.size.x > 0 && particle.size.y > 0 && particle.size.z > 0 && alpha > 0;
    }

    private updateBillboardView(view: ParticleBillboardView, particle: AnimatorParticleSnapshot) {
        const texture = this.resolveFrameTexture(particle.textureFrame);

        if (view.display.texture !== texture)
            view.display.texture = texture;

        const alpha = this.clamp01(particle.color.a * this.materialColor.alpha);
        const flipX = this.shouldFlip(particle.randomSeed, 0x68bc21eb, this.renderer.flip[0]) ? -1 : 1;
        const flipY = this.shouldFlip(particle.randomSeed, 0x02e5be93, this.renderer.flip[1]) ? -1 : 1;

        this.updateSpriteTransform(view.display, particle, texture, flipX, flipY);

        if (view.additiveShader)
        {
            view.additiveShader.setParticleColor(particle.color);
            view.display.tint = 0xffffff;
            view.display.alpha = 1;
        }
        else
        {
            const red = this.clamp01(particle.color.r * this.materialColor.red);
            const green = this.clamp01(particle.color.g * this.materialColor.green);
            const blue = this.clamp01(particle.color.b * this.materialColor.blue);

            view.display.tint =
                (Math.round(red * 255) << 16) |
                (Math.round(green * 255) << 8) |
                Math.round(blue * 255);

            view.display.alpha = alpha;
        }

        view.display.visible = particle.size.x > 0 && particle.size.y > 0 && alpha > 0;
    }

    private updateSpriteTransform(sprite: Mesh<MeshGeometry>, particle: AnimatorParticleSnapshot, texture: Texture, flipX: number, flipY: number) {
        const world = this.resolveParticleWorldMatrix(particle);
        const horizontalScale = flipX * particle.size.x / texture.width;
        const verticalScale = -flipY * particle.size.y / texture.height;

        const rotation = {
            x: this.renderer.renderAlignment === 0
                ? -particle.rotation.x
                : particle.rotation.x,
            y: particle.rotation.y,
            z: -particle.rotation.z
        };

        const horizontal = this.rotateParticleAxis(1, 0, 0, rotation);
        const vertical = this.rotateParticleAxis(0, 1, 0, rotation);

        let a: number;
        let b: number;
        let c: number;
        let d: number;

        if (this.renderer.renderAlignment === 0)
        {
            const worldScaleX = Math.hypot(world[0], world[4], world[8]);
            const worldScaleY = Math.hypot(world[1], world[5], world[9]);

            a = horizontal.x * horizontalScale * worldScaleX;
            b = horizontal.y * horizontalScale * worldScaleY;
            c = vertical.x * verticalScale * worldScaleX;
            d = vertical.y * verticalScale * worldScaleY;
        }
        else
        {
            a = (
                world[0] * horizontal.x +
                world[1] * horizontal.y +
                world[2] * horizontal.z
            ) * horizontalScale;

            b = (
                world[4] * horizontal.x +
                world[5] * horizontal.y +
                world[6] * horizontal.z
            ) * horizontalScale;

            c = (
                world[0] * vertical.x +
                world[1] * vertical.y +
                world[2] * vertical.z
            ) * verticalScale;

            d = (
                world[4] * vertical.x +
                world[5] * vertical.y +
                world[6] * vertical.z
            ) * verticalScale;
        }

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

    private updateMeshGeometry(view: ParticleMeshView, particle: AnimatorParticleSnapshot, flipX: number, flipY: number, flipZ: number) {
        const mesh = this.renderer.mesh;
        if (!mesh)
            throw new Error(`ParticleSystemRenderer "${this.renderer.id}" has no Mesh.`);

        const world = this.resolveParticleWorldMatrix(particle);

        for (let vertexIndex = 0; vertexIndex < mesh.vertexCount; vertexIndex++)
        {
            const sourceOffset = vertexIndex * 3;
            const targetOffset = vertexIndex * 2;

            const local = this.rotateParticleAxis(
                (mesh.positions[sourceOffset] + this.renderer.pivot[0]) * particle.size.x * flipX,
                (mesh.positions[sourceOffset + 1] + this.renderer.pivot[1]) * particle.size.y * flipY,
                (mesh.positions[sourceOffset + 2] + this.renderer.pivot[2]) * particle.size.z * flipZ,
                particle.rotation
            );

            const x = particle.position.x + local.x;
            const y = particle.position.y + local.y;
            const z = particle.position.z + local.z;

            view.positions[targetOffset] = world[0] * x + world[1] * y + world[2] * z + world[3];
            view.positions[targetOffset + 1] = world[4] * x + world[5] * y + world[6] * z + world[7];
        }

        view.geometry.positions.set(view.positions);
        view.geometry.getBuffer("aPosition").update();
    }

    private updateMeshTextureCoordinates(view: ParticleMeshView) {
        if (view.textureTransformRevision === this.textureTransformRevision)
            return;

        AnimatorRuntimeUtils.writeTransformedTextureCoordinates(
            view.geometry.uvs,
            view.sourceUv0,
            [this.textureScaleX, this.textureScaleY, this.textureOffsetX, this.textureOffsetY]
        );

        view.geometry.getBuffer("aUV").update();
        view.textureTransformRevision = this.textureTransformRevision;
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


    private releaseBillboardView(particleId: number, view: ParticleBillboardView) {
        this.billboardViewsByParticleId.delete(particleId);

        view.display.visible = false;
        view.display.alpha = 0;

        this.availableBillboardViews.push(view);
    }

    private releaseMeshView(particleId: number, view: ParticleMeshView) {
        this.meshViewsByParticleId.delete(particleId);

        view.display.visible = false;
        view.display.alpha = 0;

        this.availableMeshViews.push(view);
    }

    private releaseAllBillboardViews() {
        for (const [particleId, view] of this.billboardViewsByParticleId)
            this.releaseBillboardView(particleId, view);
    }

    private releaseAllMeshViews() {
        for (const [particleId, view] of this.meshViewsByParticleId)
            this.releaseMeshView(particleId, view);
    }

    private destroyAllMeshViews() {
        const views = [
            ...this.meshViewsByParticleId.values(),
            ...this.availableMeshViews
        ];

        this.meshViewsByParticleId.clear();
        this.availableMeshViews.length = 0;

        for (const view of views)
        {
            view.display.parent?.removeChild(view.display);
            view.display.destroy();
            view.additiveShader?.destroy(false);
            view.geometry.destroy(true);
        }
    }

    private destroyAllBillboardViews() {
        const views = [
            ...this.billboardViewsByParticleId.values(),
            ...this.availableBillboardViews
        ];

        this.billboardViewsByParticleId.clear();
        this.availableBillboardViews.length = 0;

        for (const view of views)
        {
            view.display.parent?.removeChild(view.display);
            view.display.destroy();
            view.additiveShader?.destroy(false);
        }
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

    private resolveMaterialColor(material: AnimatorRuntimeMaterial): AnimatorParticleMaterialColor {
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

    private resolveParticleWorldMatrix(particle: AnimatorParticleSnapshot) {
        return particle.simulationMatrix ?? this.hierarchy.requireParticleWorldMatrix(this.renderer.transformId, this.renderer.scalingMode);
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
