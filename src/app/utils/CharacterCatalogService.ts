import type {
    CharacterCatalog,
    CharacterSkin,
    SpineHitbox,
    SpinePreviewData,
    CharacterBackgroundPreview,
    PreviewSprite,
    PreviewTransform
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
    private readonly MAX_ASSETS_PER_ENTRY = 10;
    private readonly MAX_SPINE_NAME_LENGTH = 128;
    private readonly MAX_SPINE_SCALE = 10;
    private readonly MAX_HITBOX_COORDINATE = 100_000;
    private readonly MAX_HITBOX_SIZE = 100_000;
    private readonly MAX_SPECIAL_TOUCH_HITBOXES = 2;
    private readonly MAX_BACKGROUND_LAYERS = 32;
    private readonly MAX_PREVIEW_DIMENSION = 100_000;
    private readonly MAX_PREVIEW_TRANSFORM_VALUE = 100_000;
    private readonly MAX_BACKGROUND_ZOOM = 10;
    static readonly MAX_CATALOG_SIZE = 1 * 1024 ** 2;

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
            return Object.freeze({
                ...common,
                isSpineSkin: false,
                isAnimatorSkin: true,
                isStaticSkin: false
            });
        }

        return Object.freeze({
            ...common,
            isSpineSkin: false,
            isAnimatorSkin: false,
            isStaticSkin: true
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
        if (pivotX < 0 || pivotX > 1 || pivotY < 0 || pivotY > 1)
            throw new Error(`${fieldName} has an invalid pivot.`);

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
