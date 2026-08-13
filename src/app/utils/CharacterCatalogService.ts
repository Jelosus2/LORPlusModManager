import type {
    CharacterCatalog,
    CharacterSkin,
    SpineHitbox,
    SpinePreviewData,
    CharacterBackgroundPreview,
    PreviewSprite,
    PreviewTransform,
    StaticPreviewData,
    StaticPreviewFace,
    StaticPreviewHitbox,
    StaticPreviewLayer,
    StaticPreviewRenderer,
    StaticPreviewSpriteSource,
    SpineMosaicMask,
    AnimatorPreviewData,
    PreviewFaceExpression
} from "../../shared/characters.js";

import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { VersionUtils } from "./VersionUtils.js";
import { StringUtils } from "./StringUtils.js";
import { ErrorUtils } from "./ErrorUtils.js";
import { TypeCheck } from "./TypeCheck.js";
import { randomUUID } from "node:crypto";
import { Paths } from "./Paths.js";
import path from "node:path";
import fse from "fs-extra";

type LoadedCatalog = {
    filePath: string;
    catalog: CharacterCatalog;
};

export class CharacterCatalogService {
    private catalog: CharacterCatalog | null = null;
    private loadingPromise: Promise<CharacterCatalog> | null = null;
    private skinsById = new Map<string, readonly CharacterSkin[]>();
    private skinsByCharacterName = new Map<string, readonly CharacterSkin[]>();
    private skinsByAssetName = new Map<string, readonly CharacterSkin[]>();
    private readonly EMPTY_RESULTS: readonly CharacterSkin[] = Object.freeze([]);
    private readonly MAX_CATALOG_ENTRIES = 2000;
    private readonly MAX_ASSETS_PER_ENTRY = 20;
    private readonly MAX_SPINE_NAME_LENGTH = 128;
    private readonly MAX_SPINE_SCALE = 10;
    private readonly MAX_HITBOX_COORDINATE = 100_000;
    private readonly MAX_HITBOX_SIZE = 100_000;
    private readonly MAX_SPECIAL_TOUCH_HITBOXES = 2;
    private readonly MAX_BACKGROUND_LAYERS = 32;
    private readonly MAX_PREVIEW_DIMENSION = 100_000;
    private readonly MAX_PREVIEW_TRANSFORM_VALUE = 100_000;
    private readonly MAX_BACKGROUND_ZOOM = 10;
    private readonly MAX_STATIC_LAYERS = 128;
    private readonly MAX_STATIC_MOSAIC_MASKS = 8;
    private readonly MAX_PREVIEW_FACE_EXPRESSIONS = 32;
    private readonly MAX_STATIC_NAME_LENGTH = 128;
    private readonly MAX_STATIC_PIVOT_DISTANCE = 100;
    private readonly MAX_STATIC_MESH_VERTICES = 4096;
    private readonly MAX_STATIC_MESH_INDICES = 24_576;
    private readonly MAX_SPINE_MOSAIC_MASKS = 8;
    private readonly MAX_MOSAIC_MULTIPLIER = 100;
    static readonly MAX_CATALOG_SIZE = 5 * 1024 ** 2;

    async getCatalog(): Promise<CharacterCatalog> {
        if (this.catalog)
            return this.catalog;

        this.loadingPromise ??= this.loadCatalog();

        try
        {
            this.catalog = await this.loadingPromise;
            return this.catalog;
        }
        finally
        {
            this.loadingPromise = null;
        }
    }

    async findBySkinId(skin2dId: string): Promise<readonly CharacterSkin[]> {
        await this.getCatalog();

        return this.skinsById.get(StringUtils.normalize(skin2dId)) ?? this.EMPTY_RESULTS;
    }

    async findByCharacterName(characterName: string): Promise<readonly CharacterSkin[]> {
        await this.getCatalog();

        return this.skinsByCharacterName.get(StringUtils.normalize(characterName)) ?? this.EMPTY_RESULTS;
    }

    async findByAssetName(assetName: string): Promise<readonly CharacterSkin[]> {
        await this.getCatalog();

        return this.skinsByAssetName.get(StringUtils.normalize(assetName)) ?? this.EMPTY_RESULTS;
    }

    async findSkin(skin2dId: string, variantId: string | null): Promise<CharacterSkin | null> {
        const candidates = await this.findBySkinId(skin2dId);

        const normalizedVariant = variantId === null
            ? null
            : StringUtils.normalize(variantId);

        return candidates.find((candidate) => {
            const candidateVariant = candidate.variantId === null
                ? null
                : StringUtils.normalize(candidate.variantId);

            return candidateVariant === normalizedVariant;
        }) ?? null;
    }

    async installCatalogContents(contents: string): Promise<CharacterCatalog> {
        const catalog = this.parseCatalogContents(contents);
        const targetPath = Paths.getCachedCharacterCatalogPath();
        const targetDirectory = path.dirname(targetPath);
        const temporaryPath = path.join(targetDirectory, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);

        await fse.ensureDir(targetDirectory);

        try
        {
            await fse.writeFile(temporaryPath, contents, { encoding: "utf-8", flag: "wx" });
            await this.readCatalog(temporaryPath);
            await fse.move(temporaryPath, targetPath, { overwrite: true });
        }
        catch (error)
        {
            throw ErrorUtils.withContext("The character catalog could not be saved.", error);
        }
        finally
        {
            try
            {
                await fse.rm(temporaryPath, { force: true });
            }
            catch (error)
            {
                ApplicationLogger.warning(ApplicationLogSource.catalog, "Could not remove the temporary character catalog.", error);
            }
        }

        this.buildIndexes(catalog);
        this.catalog = catalog;

        ApplicationLogger.info(ApplicationLogSource.catalog, `Installed character catalog ${catalog.version}.`);

        return catalog;
    }

    async getBundledCatalog(): Promise<CharacterCatalog> {
        return this.readCatalog(Paths.getBundledCharacterCatalogPath());
    }

    parseCatalogContents(contents: string): CharacterCatalog {
        if (Buffer.byteLength(contents, "utf-8") > CharacterCatalogService.MAX_CATALOG_SIZE)
            throw new Error("The character catalog is too large.");

        let value: unknown;

        try
        {
            value = JSON.parse(contents);
        }
        catch (error)
        {
            throw new Error("The character catalog contains invalid JSON.", { cause: error });
        }

        return this.parseCatalog(value);
    }

    private async loadCatalog(): Promise<CharacterCatalog> {
        const candidatePaths = [
            Paths.getBundledCharacterCatalogPath(),
            Paths.getCachedCharacterCatalogPath()
        ];

        const validCatalogs: LoadedCatalog[] = [];
        const failures: unknown[] = [];

        for (const filePath of candidatePaths)
        {
            try
            {
                validCatalogs.push({
                    filePath,
                    catalog: await this.readCatalog(filePath)
                });
            }
            catch (error)
            {
                if (error instanceof Error && "code" in error && error.code === "ENOENT")
                    continue;

                failures.push(error);
                ApplicationLogger.error(ApplicationLogSource.catalog, `Could not load character catalog from ${filePath}.`, error);
            }
        }

        if (validCatalogs.length === 0)
            throw new Error("No valid character catalog is available.", { cause: failures[0] });

        validCatalogs.sort((left, right) =>
            left.catalog.version.localeCompare(right.catalog.version, undefined, { numeric: true, sensitivity: "base" })
        );

        const selected = validCatalogs.at(-1)!;

        this.buildIndexes(selected.catalog);
        ApplicationLogger.info(ApplicationLogSource.catalog, `Loaded character catalog ${selected.catalog.version} from ${selected.filePath}.`);

        return selected.catalog;
    }

    private async readCatalog(filePath: string): Promise<CharacterCatalog> {
        const stats = await fse.stat(filePath);

        if (!stats.isFile())
            throw new Error(`${filePath} is not a file.`);
        if (stats.size > CharacterCatalogService.MAX_CATALOG_SIZE)
            throw new Error("The character catalog is too large.");

        const contents = await fse.readFile(filePath, { encoding: "utf-8" });
        return this.parseCatalogContents(contents);
    }

    private parseCatalog(value: unknown): CharacterCatalog {
        if (!TypeCheck.isRecord(value))
            throw new Error("The character catalog is not an object.");

        const version = VersionUtils.validate(value.version, "catalog version");

        if (!TypeCheck.isValidArray(value.characters))
            throw new Error("The catalog has no characters array.");
        if (value.characters.length > this.MAX_CATALOG_ENTRIES)
            throw new Error("The catalog contains too many entries.");

        const characters = Object.freeze(value.characters.map((entry, index) => this.parseCharacterSkin(entry, index)));

        this.validateCharacterIdentities(characters);

        return Object.freeze({
            version,
            characters
        });
    }

    private parseCharacterSkin(value: unknown, index: number): CharacterSkin {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Character catalog entry ${index} is not an object.`);

        const assetsValue = value.assets;

        if (!TypeCheck.isValidArray(assetsValue) || assetsValue.length === 0)
            throw new Error(`Character catalog entry ${index} has no assets.`);
        if (assetsValue.length > this.MAX_ASSETS_PER_ENTRY)
            throw new Error(`Character catalog entry ${index} has too many assets.`);

        const assets = Object.freeze(
            assetsValue.map((asset, assetIndex) => this.readFileName(asset, `entry ${index} asset ${assetIndex}`))
        );

        const backgroundPreview = this.parseBackgroundPreview(value.backgroundPreview, index);

        const isSpineSkin = this.readBoolean(value.isSpineSkin, `entry ${index} isSpineSkin`);
        const isAnimatorSkin = this.readBoolean(value.isAnimatorSkin, `entry ${index} isAnimatorSkin`);
        const isStaticSkin = this.readBoolean(value.isStaticSkin, `entry ${index} isStaticSkin`);
        const enabledSkinTypes = [isSpineSkin, isAnimatorSkin, isStaticSkin].filter(Boolean).length;

        if (enabledSkinTypes !== 1)
            throw new Error(`Character catalog entry ${index} must have exactly one skin type.`);

        const common = {
            skin2dId: this.readString(value.skin2dId, `entry ${index} skin2dId`),
            variantId: this.readOptionalString(value.variantId, `entry ${index} variantId`, 20),
            characterName: this.readString(value.characterName, `entry ${index} characterName`),
            skinName: this.readString(value.skinName, `entry ${index} skinName`),
            iconFile: this.readFileName(value.iconFile, `entry ${index} iconFile`),
            isRPlusSkin: this.readBoolean(value.isRPlusSkin, `entry ${index} isRPlusSkin`),
            backgroundPreview,
            assets
        };

        if (isSpineSkin)
        {
            if (Object.hasOwn(value, "staticPreview"))
                throw new Error(`Spine character catalog entry ${index} contains static preview data.`);
            if (Object.hasOwn(value, "animatorPreview"))
                throw new Error(`Spine character catalog entry ${index} contains Animator preview data.`);

            return Object.freeze({
                ...common,
                isSpineSkin: true,
                isAnimatorSkin: false,
                isStaticSkin: false,
                spinePreview: this.parseSpinePreview(value.spinePreview, index)
            });
        }

        if (Object.hasOwn(value, "spinePreview"))
            throw new Error(`Non-Spine character catalog entry ${index} contains Spine preview data.`);

        if (isAnimatorSkin) {
            if (Object.hasOwn(value, "staticPreview"))
                throw new Error(`Animator character catalog entry ${index} contains static preview data.`);

            return Object.freeze({
                ...common,
                isSpineSkin: false,
                isAnimatorSkin: true,
                isStaticSkin: false,
                animatorPreview: this.parseAnimatorPreview(value.animatorPreview, index)
            });
        }

        if (Object.hasOwn(value, "animatorPreview"))
            throw new Error(`Static character catalog entry ${index} contains Animator preview data.`);

        return Object.freeze({
            ...common,
            isSpineSkin: false,
            isAnimatorSkin: false,
            isStaticSkin: true,
            staticPreview: this.parseStaticPreview(value.staticPreview, index, assets)
        });
    }

    private parseSpinePreview(value: unknown, index: number): SpinePreviewData {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Spine character catalog entry ${index} has no valid preview data.`);
        if (!TypeCheck.isRecord(value.animations))
            throw new Error(`Spine character catalog entry ${index} has invalid preview animations.`);
        if (!TypeCheck.isRecord(value.hitboxes))
            throw new Error(`Spine character catalog entry ${index} has invalid preview hitboxes.`);

        const scale = this.readFiniteNumber(value.scale, `entry ${index} Spine preview scale`);
        if (scale <= 0 || scale > this.MAX_SPINE_SCALE)
            throw new Error(`Invalid entry ${index} Spine preview scale.`);

        const specialTouchValue = value.hitboxes.specialTouch;
        if (!TypeCheck.isValidArray(specialTouchValue, this.MAX_SPECIAL_TOUCH_HITBOXES))
            throw new Error(`Entry ${index} must have between 1 and ${this.MAX_SPECIAL_TOUCH_HITBOXES} special-touch hitboxes.`);

        const specialTouch = Object.freeze(
            specialTouchValue.map((hitbox, hitboxIndex) => this.parseSpineHitbox(hitbox, `entry ${index} special-touch hitbox ${hitboxIndex}`))
        );

        const postSpecialTouchValue = value.animations.postSpecialTouch;
        let postSpecialTouch: SpinePreviewData["animations"]["postSpecialTouch"] = null;

        if (postSpecialTouchValue !== null)
        {
            if (!TypeCheck.isRecord(postSpecialTouchValue))
                throw new Error(`Spine character catalog entry ${index} has invalid post-special-touch animations.`);

            const postTouchValue = postSpecialTouchValue.touch;

            postSpecialTouch = Object.freeze({
                idle: this.readString(
                    postSpecialTouchValue.idle,
                    `entry ${index} Spine preview post-special-touch idle animation`,
                    this.MAX_SPINE_NAME_LENGTH
                ),
                touch: postTouchValue === null
                    ? null
                    : this.readString(
                        postTouchValue,
                        `entry ${index} Spine preview post-special-touch touch animation`,
                        this.MAX_SPINE_NAME_LENGTH
                    ),
                specialTouch: this.readString(
                    postSpecialTouchValue.specialTouch,
                    `entry ${index} Spine preview post-special-touch special-touch animation`,
                    this.MAX_SPINE_NAME_LENGTH
                )
            });
        }

        if (!Array.isArray(value.mosaicMasks) || value.mosaicMasks.length > this.MAX_SPINE_MOSAIC_MASKS)
            throw new Error(`Spine character catalog entry ${index} has too many mosaic masks.`);

        const mosaicMasks = Object.freeze(
            value.mosaicMasks.map((mask, maskIndex) => this.parseSpineMosaicMask(mask, `entry ${index} Spine mosaic mask ${maskIndex}`))
        );

        return Object.freeze({
            scale,
            transform: this.parsePreviewTransform(value.transform, `entry ${index} Spine preview transform`),
            baseSkin: this.readString(value.baseSkin, `entry ${index} Spine preview baseSkin`, this.MAX_SPINE_NAME_LENGTH),
            defaultParts: this.readBoolean(value.defaultParts, `entry ${index} Spine preview defaultParts`),
            defaultParts2: this.readBoolean(value.defaultParts2, `entry ${index} Spine preview defaultParts2`),
            animations: Object.freeze({
                idle: this.readString(value.animations.idle, `entry ${index} Spine preview idle animation`, this.MAX_SPINE_NAME_LENGTH),
                touch: this.readString(value.animations.touch, `entry ${index} Spine preview touch animation`, this.MAX_SPINE_NAME_LENGTH),
                specialTouch: this.readString(value.animations.specialTouch, `entry ${index} Spine preview special-touch animation`, this.MAX_SPINE_NAME_LENGTH),
                postSpecialTouch
            }),
            mosaicMasks,
            hitboxes: Object.freeze({
                touch: this.parseSpineHitbox(value.hitboxes.touch, `entry ${index} touch hitbox`),
                specialTouch
            })
        });
    }

    private parseSpineHitbox(value: unknown, fieldName: string): SpineHitbox {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);

        const x = this.readFiniteNumber(value.x, `${fieldName} x`);
        const y = this.readFiniteNumber(value.y, `${fieldName} y`);
        const width = this.readFiniteNumber(value.width, `${fieldName} width`);
        const height = this.readFiniteNumber(value.height, `${fieldName} height`);
        const rotation = this.readFiniteNumber(value.rotation, `${fieldName} rotation`);

        if (Math.abs(x) > this.MAX_HITBOX_COORDINATE || Math.abs(y) > this.MAX_HITBOX_COORDINATE)
            throw new Error(`${fieldName} is outside the supported coordinate range.`);
        if (width <= 0 || height <= 0 || width > this.MAX_HITBOX_SIZE || height > this.MAX_HITBOX_SIZE)
            throw new Error(`${fieldName} has an invalid size.`);
        if (rotation < -90 || rotation >= 90)
            throw new Error(`${fieldName} has an invalid rotation.`);

        return Object.freeze({
            x,
            y,
            width,
            height,
            rotation
        });
    }

    private parseSpineMosaicMask(value: unknown, fieldName: string): SpineMosaicMask {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);

        const referenceScreenSize = this.readFiniteNumber(value.referenceScreenSize, `${fieldName} reference screen size`);
        const minMultiplier = this.readFiniteNumber(value.minMultiplier, `${fieldName} minimum multiplier`);
        const maxMultiplier = this.readFiniteNumber(value.maxMultiplier, `${fieldName} maximum multiplier`);

        if (referenceScreenSize <= 0 || referenceScreenSize > this.MAX_PREVIEW_DIMENSION)
            throw new Error(`${fieldName} has an invalid reference screen size.`);
        if (minMultiplier <= 0 || maxMultiplier < minMultiplier || maxMultiplier > this.MAX_MOSAIC_MULTIPLIER)
            throw new Error(`${fieldName} has invalid scale multipliers.`);

        return Object.freeze({
            ...this.parsePreviewSprite(value, fieldName),
            boneName: this.readString(value.boneName, `${fieldName} bone name`, this.MAX_SPINE_NAME_LENGTH),
            referenceScreenSize,
            minMultiplier,
            maxMultiplier
        });
    }

    private parseBackgroundPreview(value: unknown, index: number): CharacterBackgroundPreview | null {
        if (value === null)
            return null;
        if (!TypeCheck.isRecord(value))
            throw new Error(`Entry ${index} has invalid background preview data.`);
        if (!TypeCheck.isValidArray(value.layers, this.MAX_BACKGROUND_LAYERS))
            throw new Error(`Entry ${index} has an invalid number of background layers.`);

        const layers = Object.freeze(
            value.layers.map((layer, layerIndex) => {
                const fieldName = `entry ${index} background layer ${layerIndex}`;

                if (!TypeCheck.isRecord(layer))
                    throw new Error(`Invalid ${fieldName}.`);

                const file = this.readFileName(layer.file, `${fieldName} file`);
                if (!file.toLowerCase().endsWith(".webp"))
                    throw new Error(`${fieldName} is not a WebP image.`);

                const sortingOrder = this.readFiniteNumber(layer.sortingOrder, `${fieldName} sorting order`);
                if (!Number.isSafeInteger(sortingOrder))
                    throw new Error(`${fieldName} has an invalid sorting order.`);

                return Object.freeze({
                    ...this.parsePreviewSprite(layer, fieldName),
                    file,
                    sortingOrder
                });
            })
        );

        let camera: CharacterBackgroundPreview["camera"] = null;

        if (value.camera !== null)
        {
            if (!TypeCheck.isRecord(value.camera))
                throw new Error(`Entry ${index} has invalid background camera data.`);

            const zoom = this.readFiniteNumber(value.camera.zoom, `entry ${index} background camera zoom`);
            if (zoom <= 0 || zoom > this.MAX_BACKGROUND_ZOOM)
                throw new Error(`Entry ${index} has an invalid background camera zoom.`);

            camera = Object.freeze({
                ...this.parsePreviewSprite(value.camera, `entry ${index} background camera`),
                zoom
            });
        }

        return Object.freeze({
            layers,
            camera
        });
    }

    private parsePreviewSprite(value: unknown, fieldName: string): PreviewSprite {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);
        if (!TypeCheck.isRecord(value.pivot))
            throw new Error(`${fieldName} has an invalid pivot.`);

        const width = this.readFiniteNumber(value.width, `${fieldName} width`);
        const height = this.readFiniteNumber(value.height, `${fieldName} height`);
        const pivotX = this.readFiniteNumber(value.pivot.x, `${fieldName} pivot x`);
        const pivotY = this.readFiniteNumber(value.pivot.y, `${fieldName} pivot y`);

        if (width <= 0 || height <= 0 || width > this.MAX_PREVIEW_DIMENSION || height > this.MAX_PREVIEW_DIMENSION)
            throw new Error(`${fieldName} has invalid dimensions.`);
        if (Math.abs(pivotX) > this.MAX_STATIC_PIVOT_DISTANCE || Math.abs(pivotY) > this.MAX_STATIC_PIVOT_DISTANCE)
            throw new Error(`${fieldName} has a pivot outside the supported range.`);

        return Object.freeze({
            width,
            height,
            pivot: Object.freeze({
                x: pivotX,
                y: pivotY
            }),
            transform: this.parsePreviewTransform(value.transform, `${fieldName} transform`)
        });
    }

    private parsePreviewTransform(value: unknown, fieldName: string): PreviewTransform {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);

        const transform = {
            a: this.readFiniteNumber(value.a, `${fieldName} a`),
            b: this.readFiniteNumber(value.b, `${fieldName} b`),
            c: this.readFiniteNumber(value.c, `${fieldName} c`),
            d: this.readFiniteNumber(value.d, `${fieldName} d`),
            tx: this.readFiniteNumber(value.tx, `${fieldName} tx`),
            ty: this.readFiniteNumber(value.ty, `${fieldName} ty`)
        };

        if (Object.values(transform).some((component) => Math.abs(component) > this.MAX_PREVIEW_TRANSFORM_VALUE))
            throw new Error(`${fieldName} exceeds the supported coordinate range.`);

        const determinant = transform.a * transform.d - transform.b * transform.c;
        if (Math.abs(determinant) < 1e-7)
            throw new Error(`${fieldName} is not invertible.`);

        return Object.freeze(transform);
    }

    private parseStaticPreview(value: unknown, index: number, assets: readonly string[]): StaticPreviewData {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Static character catalog entry ${index} has no valid preview data.`);
        if (!TypeCheck.isRecord(value.hitboxes))
            throw new Error(`Static character catalog entry ${index} has invalid preview hitboxes.`);

        if (!Array.isArray(value.layers) || value.layers.length === 0 || value.layers.length > this.MAX_STATIC_LAYERS)
            throw new Error(`Static character catalog entry ${index} has an invalid number of layers.`);

        if (!Array.isArray(value.mosaicMasks) || value.mosaicMasks.length > this.MAX_STATIC_MOSAIC_MASKS)
            throw new Error(`Static character catalog entry ${index} has too many mosaic masks.`);

        const specialTouchValue = value.hitboxes.specialTouch;

        if (!Array.isArray(specialTouchValue) || specialTouchValue.length > this.MAX_SPECIAL_TOUCH_HITBOXES)
            throw new Error(`Static character catalog entry ${index} has an invalid number of special-touch hitboxes.`);

        const catalogAssets = new Set(assets.map(StringUtils.normalize));

        const layers = Object.freeze(
            value.layers.map((layer, layerIndex) => this.parseStaticPreviewLayer(
                layer,
                `entry ${index} static layer ${layerIndex}`,
                catalogAssets
            ))
        );

        const mosaicMasks = Object.freeze(
            value.mosaicMasks.map((layer, layerIndex) => this.parseStaticPreviewLayer(
                layer,
                `entry ${index} static mosaic mask ${layerIndex}`,
                catalogAssets
            ))
        );

        const face = value.face === null
            ? null
            : this.parseStaticPreviewFace(value.face, `entry ${index} static face`);

        return Object.freeze({
            assetBundleName: this.readAssetBundleName(value.assetBundleName, `entry ${index} static asset bundle`),
            defaultParts: this.readBoolean(value.defaultParts, `entry ${index} static defaultParts`),
            defaultParts2: this.readBoolean(value.defaultParts2, `entry ${index} static defaultParts2`),
            face,
            layers,
            mosaicMasks,
            hitboxes: Object.freeze({
                touch: this.parseStaticPreviewHitbox(value.hitboxes.touch, `entry ${index} static touch hitbox`),
                specialTouch: Object.freeze(
                    specialTouchValue.map((hitbox, hitboxIndex) =>
                        this.parseStaticPreviewHitbox(hitbox, `entry ${index} static special-touch hitbox ${hitboxIndex}`)
                    )
                )
            })
        });
    }

    private parseStaticPreviewLayer(value: unknown, fieldName: string, catalogAssets: ReadonlySet<string>): StaticPreviewLayer {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);
        if (!TypeCheck.isRecord(value.sources))
            throw new Error(`${fieldName} has invalid sprite sources.`);

        const unedited = value.sources.unedited === null
            ? null
            : this.parseStaticPreviewSpriteSource(value.sources.unedited, `${fieldName} unedited source`, catalogAssets);

        const rplus = value.sources.rplus === null
            ? null
            : this.parseStaticPreviewSpriteSource(value.sources.rplus, `${fieldName} R+ source`, catalogAssets);

        if (!unedited && !rplus)
            throw new Error(`${fieldName} has no usable sprite source.`);

        return Object.freeze({
            ...this.parseStaticPreviewRenderer(value, fieldName),
            name: this.readString(value.name, `${fieldName} name`, this.MAX_STATIC_NAME_LENGTH),
            sources: Object.freeze({
                unedited,
                rplus
            })
        });
    }

    private parseStaticPreviewFace(value: unknown, fieldName: string): StaticPreviewFace {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);

        const expressions = this.parsePreviewFaceExpressions(value.expressions, `${fieldName} expressions`, false);

        return Object.freeze({
            ...this.parseStaticPreviewRenderer(value, fieldName),
            expressions
        });
    }

    private parseStaticPreviewRenderer(value: unknown, fieldName: string): StaticPreviewRenderer {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);
        if (!TypeCheck.isRecord(value.color))
            throw new Error(`${fieldName} has an invalid color.`);
        if (!TypeCheck.isRecord(value.visibility))
            throw new Error(`${fieldName} has invalid visibility data.`);

        const sortingOrder = this.readFiniteNumber(value.sortingOrder, `${fieldName} sorting order`);
        if (!Number.isSafeInteger(sortingOrder))
            throw new Error(`${fieldName} has an invalid sorting order.`);

        const color = {
            r: this.readFiniteNumber(value.color.r, `${fieldName} color r`),
            g: this.readFiniteNumber(value.color.g, `${fieldName} color g`),
            b: this.readFiniteNumber(value.color.b, `${fieldName} color b`),
            a: this.readFiniteNumber(value.color.a, `${fieldName} color a`)
        };

        if (Object.values(color).some((component) => component < 0 || component > 1))
            throw new Error(`${fieldName} has a color component outside the supported range.`);

        const part1 = value.visibility.part1;
        const part2 = value.visibility.part2;

        if (part1 !== null && part1 !== "on" && part1 !== "off")
            throw new Error(`${fieldName} has an invalid part-1 visibility state.`);
        if (part2 !== null && part2 !== "on")
            throw new Error(`${fieldName} has an invalid part-2 visibility state.`);

        return Object.freeze({
            sortingOrder,
            color: Object.freeze(color),
            transform: this.parsePreviewTransform(value.transform, `${fieldName} transform`),
            flipX: this.readBoolean(value.flipX, `${fieldName} flipX`),
            flipY: this.readBoolean(value.flipY, `${fieldName} flipY`),
            visibility: Object.freeze({
                defaultVisible: this.readBoolean(value.visibility.defaultVisible, `${fieldName} default visibility`),
                part1,
                part2
            })
        });
    }

    private parseStaticPreviewSpriteSource(value: unknown, fieldName: string, catalogAssets: ReadonlySet<string>): StaticPreviewSpriteSource {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);
        if (!TypeCheck.isRecord(value.crop))
            throw new Error(`${fieldName} has an invalid crop rectangle.`);
        if (!TypeCheck.isRecord(value.pivot))
            throw new Error(`${fieldName} has an invalid pivot.`);

        const asset = this.readFileName(value.asset, `${fieldName} asset`);

        if (!asset.toLocaleLowerCase("en-US").endsWith(".png"))
            throw new Error(`${fieldName} does not reference a PNG texture.`);
        if (!catalogAssets.has(StringUtils.normalize(asset)))
            throw new Error(`${fieldName} references an asset outside its catalog entry.`);

        const crop = {
            x: this.readFiniteNumber(value.crop.x, `${fieldName} crop x`),
            y: this.readFiniteNumber(value.crop.y, `${fieldName} crop y`),
            width: this.readFiniteNumber(value.crop.width, `${fieldName} crop width`),
            height: this.readFiniteNumber(value.crop.height, `${fieldName} crop height`)
        };

        if (
            crop.x < 0 ||
            crop.y < 0 ||
            crop.width <= 0 ||
            crop.height <= 0 ||
            Object.values(crop).some((component) => component > this.MAX_PREVIEW_DIMENSION)
        )
        {
            throw new Error(`${fieldName} has an invalid crop rectangle.`);
        }

        const width = this.readFiniteNumber(value.width, `${fieldName} width`);
        const height = this.readFiniteNumber(value.height, `${fieldName} height`);
        const pivotX = this.readFiniteNumber(value.pivot.x, `${fieldName} pivot x`);
        const pivotY = this.readFiniteNumber(value.pivot.y, `${fieldName} pivot y`);

        if (width <= 0 || height <= 0 || width > this.MAX_PREVIEW_DIMENSION || height > this.MAX_PREVIEW_DIMENSION)
            throw new Error(`${fieldName} has invalid dimensions.`);
        if (Math.abs(pivotX) > this.MAX_STATIC_PIVOT_DISTANCE || Math.abs(pivotY) > this.MAX_STATIC_PIVOT_DISTANCE)
            throw new Error(`${fieldName} has a pivot outside the supported range.`);

        let mesh: StaticPreviewSpriteSource["mesh"] = null;

        if (value.mesh !== null)
        {
            if (!TypeCheck.isRecord(value.mesh))
                throw new Error(`${fieldName} has invalid Sprite mesh data.`);

            const vertexBytes = this.decodeCatalogBase64(value.mesh.vertices, `${fieldName} mesh vertices`, this.MAX_STATIC_MESH_VERTICES * 8);
            const indexBytes = this.decodeCatalogBase64(value.mesh.triangles, `${fieldName} mesh triangles`, this.MAX_STATIC_MESH_INDICES * 2);

            if (vertexBytes.length < 24 || vertexBytes.length % 8 !== 0)
                throw new Error(`${fieldName} has invalid Sprite mesh vertices.`);
            if (indexBytes.length < 6 || indexBytes.length % 6 !== 0)
                throw new Error(`${fieldName} has invalid Sprite mesh triangles.`);

            const vertices: number[] = [];

            for (let offset = 0; offset < vertexBytes.length; offset += 4)
            {
                const component = vertexBytes.readFloatLE(offset);

                if (!Number.isFinite(component) || Math.abs(component) > this.MAX_PREVIEW_DIMENSION)
                    throw new Error(`${fieldName} has an invalid Sprite mesh vertex.`);

                vertices.push(component);
            }

            const vertexCount = vertices.length / 2;
            const triangles: number[] = [];

            for (let offset = 0; offset < indexBytes.length; offset += 2)
            {
                const vertexIndex = indexBytes.readUInt16LE(offset);

                if (vertexIndex >= vertexCount)
                    throw new Error(`${fieldName} has an invalid Sprite mesh index.`);

                triangles.push(vertexIndex);
            }

            mesh = Object.freeze({
                vertices: Object.freeze(vertices),
                triangles: Object.freeze(triangles)
            });
        }

        return Object.freeze({
            asset,
            crop: Object.freeze(crop),
            width,
            height,
            pivot: Object.freeze({
                x: pivotX,
                y: pivotY
            }),
            mesh
        });
    }

    private parseStaticPreviewHitbox(value: unknown, fieldName: string): StaticPreviewHitbox {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Invalid ${fieldName}.`);

        const width = this.readFiniteNumber(value.width, `${fieldName} width`);
        const height = this.readFiniteNumber(value.height, `${fieldName} height`);

        if (width <= 0 || height <= 0 || width > this.MAX_HITBOX_SIZE || height > this.MAX_HITBOX_SIZE)
            throw new Error(`${fieldName} has an invalid size.`);

        return Object.freeze({
            width,
            height,
            transform: this.parsePreviewTransform(value.transform, `${fieldName} transform`)
        });
    }

    private parseAnimatorPreview(value: unknown, index: number): AnimatorPreviewData {
        if (!TypeCheck.isRecord(value))
            throw new Error(`Animator character catalog entry ${index} has no valid preview data.`);

        return Object.freeze({
            faces: this.parsePreviewFaceExpressions(value.faces, `entry ${index} Animator faces`, true)
        });
    }

    private parsePreviewFaceExpressions(value: unknown, fieldName: string, allowEmpty: boolean): readonly PreviewFaceExpression[] {
        if (!Array.isArray(value) || value.length > this.MAX_PREVIEW_FACE_EXPRESSIONS || (!allowEmpty && value.length === 0))
            throw new Error(`${fieldName} has no valid expressions.`);

        const identities = new Set<string>();

        return Object.freeze(value.map((expression, expressionIndex) => {
            if (!TypeCheck.isRecord(expression))
                throw new Error(`Invalid ${fieldName} expression ${expressionIndex}.`);

            const assetName = this.readUnityAssetName(expression.assetName, `${fieldName} expression ${expressionIndex} asset`);
            const bundleName = this.readAssetBundleName(expression.bundleName, `${fieldName} expression ${expressionIndex} bundle`);

            const identity = JSON.stringify([
                StringUtils.normalize(bundleName),
                StringUtils.normalize(assetName)
            ]);

            if (identities.has(identity))
                throw new Error(`${fieldName} contains a duplicate expression: ${assetName}.`);

            identities.add(identity);

            return Object.freeze({
                assetName,
                bundleName
            });
        }));
    }

    private readAssetBundleName(value: unknown, fieldName: string): string {
        if (!Paths.isSafeGameAssetBundleName(value))
            throw new Error(`Invalid ${fieldName}.`);

        return value;
    }

    private readUnityAssetName(value: unknown, fieldName: string): string {
        const assetName = this.readString(value, fieldName, this.MAX_STATIC_NAME_LENGTH);
        if (/[\u0000-\u001f\u007f]/.test(assetName))
            throw new Error(`Invalid ${fieldName}.`);

        return assetName;
    }

    private buildIndexes(catalog: CharacterCatalog) {
        this.skinsById = this.buildIndex(catalog.characters, (skin) => [skin.skin2dId]);
        this.skinsByCharacterName = this.buildIndex(catalog.characters, (skin) => [skin.characterName]);
        this.skinsByAssetName = this.buildIndex(catalog.characters, (skin) => skin.assets);
    }

    private buildIndex(
        entries: readonly CharacterSkin[],
        getKeys: (entry: CharacterSkin) => readonly string[]
    ): Map<string, readonly CharacterSkin[]> {
        const mutableIndex = new Map<string, CharacterSkin[]>();

        for (const entry of entries)
        {
            for (const key of getKeys(entry))
            {
                const normalizedKey = StringUtils.normalize(key);
                const bucket = mutableIndex.get(normalizedKey);

                if (bucket)
                    bucket.push(entry);
                else
                    mutableIndex.set(normalizedKey, [entry]);
            }
        }

        const index = new Map<string, readonly CharacterSkin[]>();

        for (const [key, entries] of mutableIndex)
            index.set(key, Object.freeze(entries));

        return index;
    }

    private validateCharacterIdentities(characters: readonly CharacterSkin[]) {
        const identities = new Set<string>();
        const entriesBySkinId = new Map<string, CharacterSkin[]>();

        for (const character of characters)
        {
            const skinKey = StringUtils.normalize(character.skin2dId);
            const variantKey = character.variantId
                ? StringUtils.normalize(character.variantId)
                : "";

            const identity = `${skinKey}\0${variantKey}`;
            if (identities.has(identity))
                throw new Error(`Duplicate character catalog identity: ${character.skin2dId}/${character.variantId ?? "default"}.`);

            identities.add(identity);

            const entries = entriesBySkinId.get(skinKey) ?? [];
            entries.push(character);

            entriesBySkinId.set(skinKey, entries);
        }

        for (const entries of entriesBySkinId.values())
        {
            if (entries.length > 1 && entries.some(({ variantId }) => variantId === null))
                throw new Error(`Catalog entries sharing ${entries[0].skin2dId} require variant IDs.`);
        }
    }

    private decodeCatalogBase64(value: unknown, fieldName: string, maximumDecodedBytes: number): Buffer {
        if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumDecodedBytes / 3) * 4)
            throw new Error(`${fieldName} has invalid encoded data.`);

        const decoded = Buffer.from(value, "base64");
        if (decoded.length === 0 || decoded.length > maximumDecodedBytes || decoded.toString("base64") !== value)
            throw new Error(`${fieldName} has invalid encoded data.`);

        return decoded;
    }

    private readString(value: unknown, fieldName: string, maxLength = 512): string {
        if (!TypeCheck.isValidString(value, maxLength))
            throw new Error(`Invalid ${fieldName}.`);

        return value;
    }

    private readOptionalString(value: unknown, fieldName: string, maxLength = 512): string | null {
        if (value === undefined || value === null)
            return null;

        return this.readString(value, fieldName, maxLength);
    }

    private readFileName(value: unknown, fieldName: string): string {
        const fileName = this.readString(value, fieldName, 100);
        if (fileName === "." || fileName === ".." || /[\\/\u0000]/.test(fileName))
            throw new Error(`Invalid ${fieldName}.`);

        return fileName;
    }

    private readBoolean(value: unknown, fieldName: string): boolean {
        if (!TypeCheck.isBoolean(value))
            throw new Error(`Invalid ${fieldName}.`);

        return value;
    }

    private readFiniteNumber(value: unknown, fieldName: string): number {
        if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error(`Invalid ${fieldName}.`);

        return value;
    }
}

export const characterCatalog = new CharacterCatalogService();
