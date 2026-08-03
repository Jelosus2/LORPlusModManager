import type { CharacterCatalog, CharacterSkin } from "../../shared/characters.js";

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
                console.error("Could not remove the temporary character catalog:", error);
            }
        }

        this.buildIndexes(catalog);
        this.catalog = catalog;

        console.log(`Installed character catalog ${catalog.version}.`);

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
                console.error(`Could not load character catalog from ${filePath}:`, error);
            }
        }

        if (validCatalogs.length === 0)
            throw new Error("No valid character catalog is available.", { cause: failures[0] });

        validCatalogs.sort((left, right) =>
            left.catalog.version.localeCompare(right.catalog.version, undefined, { numeric: true, sensitivity: "base" })
        );

        const selected = validCatalogs.at(-1)!;

        this.buildIndexes(selected.catalog);
        console.log(`Loaded character catalog ${selected.catalog.version} from ${selected.filePath}.`);

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

        return Object.freeze({
            skin2dId: this.readString(value.skin2dId, `entry ${index} skin2dId`),
            variantId: this.readOptionalString(value.variantId, `entry ${index} variantId`, 20),
            characterName: this.readString(value.characterName, `entry ${index} characterName`),
            skinName: this.readString(value.skinName, `entry ${index} skinName`),
            iconFile: this.readFileName(value.iconFile, `entry ${index} iconFile`),
            isSpineSkin: this.readBoolean(value.isSpineSkin, `entry ${index} isSpineSkin`),
            isAnimatorSkin: this.readBoolean(value.isAnimatorSkin, `entry ${index} isAnimatorSkin`),
            isStaticSkin: this.readBoolean(value.isStaticSkin, `entry ${index} isStaticSkin`),
            assets
        });
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
}

export const characterCatalog = new CharacterCatalogService();
