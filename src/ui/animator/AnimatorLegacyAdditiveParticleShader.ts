import type { AnimatorRuntimeMaterial } from "./AnimatorBindingResolver";

import { GlProgram, Matrix, Shader, Texture } from "pixi.js";

export type AnimatorParticleMaterialColor = Readonly<{
    red: number;
    green: number;
    blue: number;
    alpha: number;
}>;

export type AnimatorLegacyParticleShaderMode =
    | "additive"
    | "additional-alpha-additive"
    | "soft-additive";

const PROGRAM = GlProgram.from({
    name: "animator-legacy-particles-additive",
    vertex: `
        in vec2 aPosition;
        in vec2 aUV;

        out vec2 vUV;
        out vec4 vColor;

        uniform mat3 uProjectionMatrix;
        uniform mat3 uWorldTransformMatrix;
        uniform mat3 uTransformMatrix;
        uniform mat3 uTextureMatrix;

        uniform vec4 uWorldColorAlpha;
        uniform vec4 uColor;

        void main() {
            vUV = (uTextureMatrix * vec3(aUV, 1.0)).xy;
            vColor = uWorldColorAlpha * uColor;

            mat3 transform = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
            gl_Position = vec4((transform * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        }
    `,
    fragment: `
        in vec2 vUV;
        in vec4 vColor;

        out vec4 finalColor;

        uniform sampler2D uTexture;
        uniform vec4 uParticleColor;
        uniform vec4 uMaterialColor;
        uniform float uColorMultiplier;

        void main() {
            vec4 sampled = texture(uTexture, vUV);

            vec3 textureColor = sampled.a > 0.000001
                ? sampled.rgb / sampled.a
                : vec3(0.0);

            vec4 unityFragment = clamp(vec4(textureColor, sampled.a) * uParticleColor * uMaterialColor * uColorMultiplier, 0.0, 1.0);
            float additiveCoverage = clamp(max(textureColor.r, max(textureColor.g, textureColor.b)), 0.0, 1.0);

            finalColor = vec4(unityFragment.rgb * unityFragment.a, unityFragment.a * additiveCoverage) * vColor;
        }
    `
});

export class AnimatorLegacyAdditiveParticleShader extends Shader {
    private readonly textureMatrix: Matrix;
    private readonly particleColor: Float32Array;
    private _texture: Texture;

    constructor(texture: Texture, materialColor: AnimatorParticleMaterialColor, mode: AnimatorLegacyParticleShaderMode) {
        const textureMatrix = new Matrix().copyFrom(texture.textureMatrix.mapCoord);
        const particleColor = new Float32Array([1, 1, 1, 1]);
        const usesSoftAdditive = mode === "soft-additive";
        const usesLegacyDoubleColor = mode === "additive";

        super({
            glProgram: PROGRAM,
            resources: {
                uTexture: texture.source,
                additiveUniforms: {
                    uTextureMatrix: {
                        value: textureMatrix,
                        type: "mat3x3<f32>"
                    },
                    uParticleColor: {
                        value: particleColor,
                        type: "vec4<f32>"
                    },
                    uMaterialColor: {
                        value: new Float32Array(
                            usesSoftAdditive
                                ? [1, 1, 1, 1]
                                : [materialColor.red, materialColor.green, materialColor.blue, materialColor.alpha]
                        ),
                        type: "vec4<f32>"
                    },
                    uColorMultiplier: {
                        value: usesLegacyDoubleColor ? 2 : 1,
                        type: "f32"
                    }
                }
            }
        });

        this._texture = texture;
        this.textureMatrix = textureMatrix;
        this.particleColor = particleColor;
    }

    get texture(): Texture {
        return this._texture;
    }

    set texture(texture: Texture) {
        this._texture = texture;
        this.resources.uTexture = texture.source;
        this.textureMatrix.copyFrom(texture.textureMatrix.mapCoord);
    }

    setParticleColor(color: Readonly<{ r: number; g: number; b: number; a: number }>) {
        this.particleColor[0] = color.r;
        this.particleColor[1] = color.g;
        this.particleColor[2] = color.b;
        this.particleColor[3] = color.a;
    }

    static resolveAnimatorLegacyParticleShaderMode(material: AnimatorRuntimeMaterial): AnimatorLegacyParticleShaderMode | null {
        const shaderName = material.shaderName?.trim().toLowerCase() ?? "";

        if (shaderName === "legacy shaders/particles/additive (soft)")
            return "soft-additive";

        const hasAdditionalAlpha = material.floatProperties.some((property) => property.name === "_AdditionalAlpha");
        const usesLastOneAdditionalAlphaShader = shaderName.startsWith("lastone/lo_sprite_loby_cha_full3dmeshbase_additional_alpha");

        if (material.blendMode === "add" && (hasAdditionalAlpha || usesLastOneAdditionalAlphaShader))
            return "additional-alpha-additive";

        if (shaderName === "legacy shaders/particles/additive" || material.blendMode === "add")
            return "additive";

        return null;
    }
}
