import { BlendMode, MeshAttachment, RegionAttachment, Skin, Spine, TextureRegion } from "@esotericsoftware/spine-pixi-v8";
import { BufferImageSource, Texture, type TextureSource } from "pixi.js";

type RegionTextureAdapter = Readonly<{
    texture: Texture;
}>;

export class SpineMultiplyAlphaCutoff {
    private readonly cutoffTextures = new Map<TextureSource, Texture>();
    private readonly processedAttachments = new WeakSet<object>();

    constructor(private readonly cutoff: number) {
        if (cutoff < 0 || cutoff > 1)
            throw new RangeError("The Spine multiply alpha cutoff must be between 0 and 1.");
    }

    apply(spine: Spine) {
        const skeletonData = spine.skeleton.data;
        const skins = [skeletonData.defaultSkin, ...skeletonData.skins].filter((skin): skin is Skin => skin !== null);

        for (const skin of skins)
        {
            for (const entry of skin.getAttachments())
            {
                const slotData = skeletonData.slots[entry.slotIndex];
                if (slotData.blendMode !== BlendMode.Multiply)
                    continue;

                const attachment = entry.attachment;

                if (!(attachment instanceof RegionAttachment) && !(attachment instanceof MeshAttachment))
                    continue;
                if (this.processedAttachments.has(attachment))
                    continue;

                const region = attachment.region;
                if (!region)
                    continue;

                const originalPixiTexture = this.getPixiTexture(region);
                const cutoffTexture = this.getOrCreateCutoffTexture(originalPixiTexture);
                const cutoffRegion = this.cloneRegion(region, cutoffTexture);

                attachment.region = cutoffRegion;
                attachment.updateRegion();

                this.processedAttachments.add(attachment);
            }
        }
    }

    destroy() {
        for (const texture of this.cutoffTextures.values())
            texture.destroy(true);

        this.cutoffTextures.clear();
    }

    private getPixiTexture(region: TextureRegion): Texture {
        const regionTexture = region.texture as { texture?: unknown } | null;
        if (!(regionTexture?.texture instanceof Texture))
            throw new Error("A multiply attachment uses an unsupported Spine texture.");

        return regionTexture.texture;
    }

    private getOrCreateCutoffTexture(originalTexture: Texture): Texture {
        const originalSource = originalTexture.source;
        const existingTexture = this.cutoffTextures.get(originalSource);

        if (existingTexture)
            return existingTexture;

        const texture = this.createCutoffTexture(originalSource);
        this.cutoffTextures.set(originalSource, texture);

        return texture;
    }

    private createCutoffTexture(originalSource: TextureSource): Texture {
        const width = originalSource.pixelWidth;
        const height = originalSource.pixelHeight;

        if (width <= 0 || height <= 0 || !originalSource.resource)
            throw new Error("A multiply attachment has an invalid atlas texture.");

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context)
            throw new Error("Could not create the multiply texture processor.");

        context.clearRect(0, 0, width, height);
        context.drawImage(originalSource.resource, 0, 0, width, height);

        const imageData = context.getImageData(0, 0, width, height);
        const pixels = imageData.data;
        const alphaCutoff = this.cutoff * 255;

        for (let i = 0; i < pixels.length; i += 4)
        {
            if (pixels[i + 3] >= alphaCutoff)
                continue;

            pixels[i] = 0;
            pixels[i + 1] = 0;
            pixels[i + 2] = 0;
            pixels[i + 3] = 0;
        }

        const source = new BufferImageSource({
            resource: new Uint8Array(pixels),
            width,
            height,
            format: "rgba8unorm",
            alphaMode: originalSource.alphaMode,
            autoGenerateMipmaps: originalSource.autoGenerateMipmaps,
            mipLevelCount: originalSource.mipLevelCount,
            magFilter: originalSource.style.magFilter,
            minFilter: originalSource.style.minFilter,
            mipmapFilter: originalSource.style.mipmapFilter,
            addressModeU: originalSource.style.addressModeU,
            addressModeV: originalSource.style.addressModeV,
            addressModeW: originalSource.style.addressModeW
        });

        return new Texture({ source });
    }

    private cloneRegion(region: TextureRegion, texture: Texture): TextureRegion {
        const clonedRegion = Object.assign(new TextureRegion(), region);

        const adapter: RegionTextureAdapter = {
            texture
        };

        clonedRegion.texture = adapter;

        return clonedRegion;
    }
}
