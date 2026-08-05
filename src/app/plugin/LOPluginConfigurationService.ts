import type {
    PluginConfiguration,
    PluginConfigurationEntry,
    PluginConfigurationSection,
    PluginConfigurationValueKind,
    PluginConfigurationSaveRequest,
    PluginConfigurationUpdate
} from "../../shared/plugin.js";

import { SettingsRepository } from "#database/repositories/SettingsRepository.js";
import { ApplicationLogger } from "#maintenance/ApplicationLogger.js";
import { ApplicationLogSource } from "../../shared/application.js";
import { UserFacingError } from "#utils/ErrorUtils.js";
import { createHash, randomUUID } from "node:crypto";
import { TypeCheck } from "#utils/TypeCheck.js";
import { Paths } from "#utils/Paths.js";
import path from "node:path";
import fse from "fs-extra";

type MutableSection = {
    id: string;
    name: string;
    entries: PluginConfigurationEntry[];
};

export class LOPluginConfigurationService {
    private static readonly MAXIMUM_FILE_SIZE = 512 * 1024;
    private static readonly MAXIMUM_SECTIONS = 100;
    private static readonly MAXIMUM_SETTINGS = 500;
    private static readonly MAXIMUM_ACCEPTABLE_VALUES = 500;
    private static readonly MAXIMUM_SETTING_VALUE_LENGTH = 100;
    private readonly settingsRepository = new SettingsRepository();
    private isSaving = false;

    async loadConfigured(): Promise<PluginConfiguration> {
        const gameLocation = this.settingsRepository.getGameLocation();
        if (!gameLocation)
            throw new UserFacingError("The game location has not been configured.");

        let gameStats: fse.Stats;

        try
        {
            gameStats = await fse.stat(gameLocation);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                throw new UserFacingError("The configured game location no longer exists.");

            throw error;
        }

        if (!gameStats.isDirectory())
            throw new UserFacingError("The configured game location is not a directory.");

        const filePath = Paths.getLOPluginConfigurationPath(gameLocation);
        let stats: fse.Stats;

        try
        {
            stats = await fse.stat(filePath);
        }
        catch (error)
        {
            if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
            {
                return {
                    exists: false,
                    filePath,
                    sections: [],
                    revision: null
                };
            }

            throw error;
        }

        if (!stats.isFile())
            throw new UserFacingError("The LOPlugin+ configuration path is not a file.");
        if (stats.size > LOPluginConfigurationService.MAXIMUM_FILE_SIZE)
            throw new UserFacingError("The LOPlugin+ configuration file is unexpectedly large.");

        const buffer = await fse.readFile(filePath);
        if (buffer.length > LOPluginConfigurationService.MAXIMUM_FILE_SIZE)
            throw new UserFacingError("The LOPlugin+ configuration file is unexpectedly large.");

        const contents = buffer.toString("utf-8").replace(/^\uFEFF/, "");

        return {
            exists: true,
            filePath,
            revision: this.createRevision(buffer),
            sections: this.parse(contents)
        };
    }

    async saveConfigured(rawRequest: unknown): Promise<PluginConfiguration> {
        if (this.isSaving)
            throw new UserFacingError("The plugin configuration is already being saved.");

        const request = this.parseSaveRequest(rawRequest);
        this.isSaving = true;

        let tempPath = "";

        try
        {
            const current = await this.loadConfigured();

            if (!current.exists || !current.revision)
                throw new UserFacingError("The LOPlugin+ configuration file no longer exists.");
            if (current.revision !== request.revision)
                throw new UserFacingError("The LOPlugin+ configuration changed outside the mod manager. Reload it before saving.");

            const buffer = await fse.readFile(current.filePath);
            if (this.createRevision(buffer) !== request.revision)
                throw new UserFacingError("The LOPlugin+ configuration changed outside the mod manager. Reload it before saving.");

            const rawContents = buffer.toString("utf-8");
            const hasByteOrderMark = rawContents.startsWith("\uFEFF");
            const contents = hasByteOrderMark
                ? rawContents.slice(1)
                : rawContents;

            const newline = contents.includes("\r\n") ? "\r\n" : "\n";
            const lines = contents.split(/\r?\n/);
            const lineIndexes = this.indexSettingLines(lines);

            for (const update of request.updates)
            {
                const entry = this.findConfigurationEntry(current.sections, update.section, update.key);
                const value = this.validateConfigurationValue(entry, update.value);
                const identity = this.getSettingIdentity(update.section, update.key);
                const lineIndex = lineIndexes.get(identity);

                if (lineIndex === undefined)
                    throw new UserFacingError(`The setting "${update.key}" in section "${update.section}" could not be found in the configuration file.`);

                const line = lines[lineIndex];
                const separatorIndex = line.indexOf("=");

                if (separatorIndex < 0)
                    throw new UserFacingError(`The setting "${update.key}" has an invalid format.`);

                const existingValue = line.slice(separatorIndex + 1);
                const leadingWhitespace = existingValue.match(/^\s*/)?.[0] ?? "";

                lines[lineIndex] = line.slice(0, separatorIndex + 1) + leadingWhitespace + value;
            }

            const updatedContents = (hasByteOrderMark ? "\uFEFF" : "") + lines.join(newline);
            if (Buffer.byteLength(updatedContents, "utf-8") > LOPluginConfigurationService.MAXIMUM_FILE_SIZE)
                throw new UserFacingError("The updated LOPlugin+ configuration would be unexpectedly large.");

            tempPath = path.join(path.dirname(current.filePath), `.${path.basename(current.filePath)}.${randomUUID()}.tmp`);
            await fse.writeFile(tempPath, updatedContents, { encoding: "utf-8", flag: "wx" });

            const latestBuffer = await fse.readFile(current.filePath);
            if (this.createRevision(latestBuffer) !== request.revision)
                throw new UserFacingError("The LOPlugin+ configuration changed while it was being saved. Reload it and try again.");

            await fse.move(tempPath, current.filePath, { overwrite: true });
            tempPath = "";

            return await this.loadConfigured();
        }
        finally
        {
            this.isSaving = false;

            if (tempPath)
            {
                try
                {
                    await fse.rm(tempPath, { force: true });
                }
                catch (error)
                {
                    ApplicationLogger.warning(ApplicationLogSource.plugin, "Could not remove a temporary plugin configuration file.", error);
                }
            }
        }
    }

    private parse(contents: string): readonly PluginConfigurationSection[] {
        const lines = contents.split(/\r?\n/);
        if (lines.length > 1000)
            throw new UserFacingError("The LOPlugin+ configuration contains too many lines.");

        const sections: MutableSection[] = [];
        const sectionsByName = new Map<string, MutableSection>();

        let currentSection: MutableSection | null = null;
        let descriptions: string[] = [];
        let settingType = "";
        let defaultValue = "";
        let acceptableValues: string[] = [];
        let settingCount = 0;

        const resetMetadata = () => {
            descriptions = [];
            settingType = "";
            defaultValue = "";
            acceptableValues = [];
        };

        for (let i = 0; i < lines.length; i++)
        {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed)
                continue;

            const sectionMatch = trimmed.match(/^\[([^\]\r\n]+)\]$/);

            if (sectionMatch)
            {
                const sectionName = sectionMatch[1].trim();
                if (!TypeCheck.isValidString(sectionName, 200))
                    throw new UserFacingError(`The LOPlugin+ configuration has an invalid section at line ${i + 1}.`);

                const normalizedName = sectionName.toLocaleLowerCase("en-US");
                let section = sectionsByName.get(normalizedName);

                if (!section)
                {
                    if (sections.length >= LOPluginConfigurationService.MAXIMUM_SECTIONS)
                        throw new UserFacingError("The LOPlugin+ configuration contains too many sections.");

                    section = {
                        id: String(sections.length + 1),
                        name: sectionName,
                        entries: []
                    };

                    sections.push(section);
                    sectionsByName.set(normalizedName, section);
                }

                currentSection = section;
                resetMetadata();
                continue;
            }

            if (trimmed.startsWith("##"))
            {
                const description = trimmed.slice(2).trim();

                if (description)
                    descriptions.push(description);

                continue;
            }

            const settingTypePrefix = "# Setting type:";
            if (trimmed.startsWith(settingTypePrefix))
            {
                settingType = trimmed.slice(settingTypePrefix.length).trim();
                continue;
            }

            const defaultValuePrefix = "# Default value:";
            if (trimmed.startsWith(defaultValuePrefix))
            {
                defaultValue = trimmed.slice(defaultValuePrefix.length).trim();
                continue;
            }

            const acceptableValuesPrefix = "# Acceptable values:";
            if (trimmed.startsWith(acceptableValuesPrefix))
            {
                acceptableValues = trimmed
                    .slice(acceptableValuesPrefix.length)
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean);

                if (acceptableValues.length > LOPluginConfigurationService.MAXIMUM_ACCEPTABLE_VALUES)
                    throw new UserFacingError("A plugin configuration setting contains too many acceptable values.");

                continue;
            }

            if (trimmed.startsWith("#") || trimmed.startsWith(";"))
                continue;

            const separatorIndex = line.indexOf("=");

            if (separatorIndex < 0)
                throw new UserFacingError(`The LOPlugin+ configuration has an invalid entry at line ${i + 1}.`);
            if (!currentSection)
                throw new UserFacingError(`The LOPlugin+ configuration has a setting outside a section at line ${i + 1}.`);

            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();

            if (!key)
                throw new UserFacingError(`The LOPlugin+ configuration has an invalid setting name at line ${i + 1}.`);

            const duplicate = currentSection.entries.some((entry) => {
                return entry.key.toLocaleLowerCase("en-US") === key.toLocaleLowerCase("en-US")
            });

            if (duplicate)
                throw new UserFacingError(`The setting "${key}" appears more than once in section "${currentSection.name}".`);

            settingCount++;
            if (settingCount > LOPluginConfigurationService.MAXIMUM_SETTINGS)
                throw new UserFacingError("The LOPlugin+ configuration contains too many settings.");

            const normalizedType = settingType || "Unknown";

            currentSection.entries.push({
                key,
                description: descriptions.join(" "),
                settingType: normalizedType,
                valueKind: this.getValueKind(normalizedType),
                value,
                defaultValue,
                acceptableValues
            });

            resetMetadata();
        }

        if (settingCount === 0)
            throw new UserFacingError("The LOPlugin+ configuration contains no settings.");

        return sections;
    }

    private parseSaveRequest(rawRequest: unknown): PluginConfigurationSaveRequest {
        if (!TypeCheck.isRecord(rawRequest))
            throw new UserFacingError("The plugin configuration save request is invalid.");

        if (!TypeCheck.isValidString(rawRequest.revision, 64) || !/^[a-f0-9]{64}$/i.test(rawRequest.revision))
            throw new UserFacingError("The plugin configuration revision is invalid.");

        if (!TypeCheck.isValidArray(rawRequest.updates, LOPluginConfigurationService.MAXIMUM_SETTINGS))
            throw new UserFacingError("No valid plugin configuration changes were provided.");

        const updates: PluginConfigurationUpdate[] = [];
        const identities = new Set<string>();

        for (const rawUpdate of rawRequest.updates)
        {
            if (!TypeCheck.isRecord(rawUpdate))
                throw new UserFacingError("A plugin configuration change is invalid.");

            if (!TypeCheck.isValidString(rawUpdate.section, 200))
                throw new UserFacingError("A plugin configuration section name is invalid.");

            if (!TypeCheck.isValidString(rawUpdate.key, 200))
                throw new UserFacingError("A plugin configuration setting name is invalid.");

            if (!TypeCheck.isString(rawUpdate.value, LOPluginConfigurationService.MAXIMUM_SETTING_VALUE_LENGTH) || /[\r\n\u0000]/.test(rawUpdate.value))
                throw new UserFacingError(`The value for "${rawUpdate.key}" is invalid or too long.`);

            const identity = this.getSettingIdentity(rawUpdate.section, rawUpdate.key);
            if (identities.has(identity))
                throw new UserFacingError(`The setting "${rawUpdate.key}" was changed more than once.`);

            identities.add(identity);

            updates.push({
                section: rawUpdate.section,
                key: rawUpdate.key,
                value: rawUpdate.value
            });
        }

        return {
            revision: rawRequest.revision,
            updates
        };
    }

    private validateConfigurationValue(entry: PluginConfigurationEntry, value: string): string {
        const trimmed = value.trim();

        if (entry.valueKind === "boolean")
        {
            if (!/^(?:true|false)$/i.test(trimmed))
                throw new UserFacingError(`"${entry.key}" must be enabled or disabled.`);

            return /^true$/i.test(trimmed) ? "true" : "false";
        }

        if (entry.acceptableValues.length > 0)
        {
            const acceptedValue = entry.acceptableValues.find((candidate) => candidate.toLocaleLowerCase("en-US") === trimmed.toLocaleLowerCase("en-US"));
            if (!acceptedValue)
                throw new UserFacingError(`"${value}" is not a valid value for "${entry.key}".`);

            return acceptedValue;
        }

        if (entry.valueKind === "number")
        {
            const numberPattern = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
            if (!numberPattern.test(trimmed) || !Number.isFinite(Number(trimmed)))
                throw new UserFacingError(`"${entry.key}" requires a valid number.`);

            return trimmed;
        }

        return entry.valueKind === "string" || entry.valueKind === "unknown"
            ? value
            : trimmed;
    }

    private indexSettingLines(lines: readonly string[]): Map<string, number> {
        const indexes = new Map<string, number>();
        let currentSection = "";

        for (let i = 0; i < lines.length; i++)
        {
            const line = lines[i];
            const trimmed = line.trim();
            const sectionMatch = trimmed.match(/^\[([^\]\r\n]+)\]$/);

            if (sectionMatch)
            {
                currentSection = sectionMatch[1].trim();
                continue;
            }

            if (!currentSection || !trimmed || trimmed.startsWith("#") || trimmed.startsWith(";"))
                continue;

            const separatorIndex = line.indexOf("=");
            if (separatorIndex < 0)
                continue;

            const key = line.slice(0, separatorIndex).trim();
            if (key)
                indexes.set(this.getSettingIdentity(currentSection, key), i);
        }

        return indexes;
    }

    private findConfigurationEntry(sections: readonly PluginConfigurationSection[], sectionName: string, key: string): PluginConfigurationEntry {
        const normalizedSection = sectionName.toLocaleLowerCase("en-US");
        const normalizedKey = key.toLocaleLowerCase("en-US");

        const section = sections.find((candidate) => candidate.name.toLocaleLowerCase("en-US") === normalizedSection);
        const entry = section?.entries.find((candidate) => candidate.key.toLocaleLowerCase("en-US") === normalizedKey);

        if (!entry)
            throw new UserFacingError(`The setting "${key}" in section "${sectionName}" is not part of the loaded configuration.`);

        return entry;
    }

    private getValueKind(settingType: string): PluginConfigurationValueKind {
        if (/^Boolean$/i.test(settingType))
            return "boolean";
        if (/^KeyCode$/i.test(settingType))
            return "keyCode";
        if (/^String$/i.test(settingType))
            return "string";
        if ( /^(?:S?Byte|U?Int(?:16|32|64)?|Short|UShort|Long|ULong|Single|Double|Decimal)$/i.test(settingType))
            return "number";

        return "unknown";
    }

    private getSettingIdentity(section: string, key: string): string {
        return JSON.stringify([
            section.toLocaleLowerCase("en-US"),
            key.toLocaleLowerCase("en-US")
        ]);
    }

    private createRevision(contents: Buffer): string {
        return createHash("sha256").update(contents).digest("hex");
    }
}
