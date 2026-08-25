import type { ApplicationLogEntry, ApplicationLogSeverity, ApplicationLogWriteRequest } from "../../shared/application.js";

import { ApplicationLogSource } from "../../shared/application.js";
import { TypeCheck } from "#utils/TypeCheck.js";
import { randomUUID } from "node:crypto";
import { Paths } from "#utils/Paths.js";
import { inspect } from "node:util";
import { homedir } from "node:os";
import path from "node:path";
import fse from "fs-extra";

type ApplicationLogOperation = Readonly<{
    complete: (details?: unknown) => void;
    completeWithWarnings: (details?: unknown) => void;
    fail: (error: unknown) => void;
}>;

export class ApplicationLogger {
    private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024;
    private static readonly MAX_RETAINED_FILES = 40;
    private static readonly MAX_VISIBLE_ENTRIES = 2000;
    private static readonly loggedErrors = new WeakSet<object>();
    private static readonly originalConsole = {
        debug: console.debug.bind(console),
        info: console.info.bind(console),
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
    };

    private static logDirectory = "";
    private static logFilePath = "";
    private static sessionId = "";
    private static sessionPart = 1;
    private static currentFileSize = 0;
    private static initialized = false;
    private static consoleCaptureInstalled = false;

    static async initialize() {
        if (ApplicationLogger.initialized)
            return;

        try
        {
            ApplicationLogger.logDirectory = Paths.getLogsPath();
            ApplicationLogger.sessionId = ApplicationLogger.createSessionId();
            ApplicationLogger.sessionPart = 1;
            ApplicationLogger.logFilePath = Paths.getLogFilePath(ApplicationLogger.sessionId, ApplicationLogger.sessionPart);

            await fse.ensureDir(ApplicationLogger.logDirectory);
            await ApplicationLogger.pruneOldLogFiles();

            ApplicationLogger.currentFileSize = 0;
            ApplicationLogger.initialized = true;

            ApplicationLogger.installConsoleCapture();
            ApplicationLogger.installProcessDiagnostics();

            ApplicationLogger.info(ApplicationLogSource.application, "Application logging initialized.");
        }
        catch (error)
        {
            ApplicationLogger.originalConsole.error("Application logging could not be initialized:", error);
        }
    }

    static async getRecentEntries(): Promise<readonly ApplicationLogEntry[]> {
        if (!ApplicationLogger.initialized)
            return [];

        const entries: ApplicationLogEntry[] = [];

        for (let part = ApplicationLogger.sessionPart; part >= 1 && entries.length < ApplicationLogger.MAX_VISIBLE_ENTRIES; part--)
        {
            const filePath = Paths.getLogFilePath(ApplicationLogger.sessionId, part);
            let content: string;

            try
            {
                content = await fse.readFile(filePath, { encoding: "utf-8" });
            }
            catch (error)
            {
                if (TypeCheck.isNodeError(error) && error.code === "ENOENT")
                    continue;

                throw error;
            }

            const lines = content.split(/\r?\n/);

            for (let i = lines.length - 1; i >= 0 && entries.length < ApplicationLogger.MAX_VISIBLE_ENTRIES; i--)
            {
                const line = lines[i];
                if (!line.trim())
                    continue;

                try
                {
                    const parsed: unknown = JSON.parse(line);

                    if (ApplicationLogger.isLogEntry(parsed) && !ApplicationLogger.isIgnoredMessage(parsed.message))
                        entries.push(parsed);
                }
                catch
                {}
            }
        }

        return entries;
    }

    static debug(source: string, message: string, details?: unknown) {
        ApplicationLogger.originalConsole.debug(`[${source}] ${message}`, details ?? "");
        ApplicationLogger.write("debug", source, message, ApplicationLogger.formatDetails(details));
    }

    static info(source: string, message: string, details?: unknown) {
        ApplicationLogger.originalConsole.info(`[${source}] ${message}`, details ?? "");
        ApplicationLogger.write("info", source, message, ApplicationLogger.formatDetails(details));
    }

    static warning(source: string, message: string, details?: unknown) {
        ApplicationLogger.originalConsole.warn(`[${source}] ${message}`, details ?? "");
        ApplicationLogger.write("warning", source, message, ApplicationLogger.formatDetails(details));
    }

    static error(source: string, message: string, error?: unknown) {
        if (error && (typeof error === "object" || typeof error === "function"))
            ApplicationLogger.loggedErrors.add(error as object);

        ApplicationLogger.originalConsole.error(`[${source}] ${message}`, error ?? "");
        ApplicationLogger.write("error", source, message, ApplicationLogger.formatDetails(error));
    }

    static write(severity: ApplicationLogSeverity, source: string, message: string, details?: string) {
        if (!ApplicationLogger.initialized)
            return;

        const normalizedSource = ApplicationLogger.normalizeText(ApplicationLogger.redactSensitiveData(source), 100, "Application");
        const normalizedMessage = ApplicationLogger.normalizeText(ApplicationLogger.redactSensitiveData(message), 4000, "No message was provided.");

        if (ApplicationLogger.isIgnoredMessage(normalizedMessage))
            return;

        const normalizedDetails = details?.trim()
            ? ApplicationLogger.redactSensitiveData(details).trim().slice(0, 20_000)
            : undefined;

        const entry: ApplicationLogEntry = normalizedDetails
            ? {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                severity,
                source: normalizedSource,
                message: normalizedMessage,
                details: normalizedDetails
            }
            : {
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                severity,
                source: normalizedSource,
                message: normalizedMessage
            };

        const line = `${JSON.stringify(entry)}\n`;
        const lineSize = Buffer.byteLength(line, "utf-8");

        try
        {
            if (ApplicationLogger.currentFileSize + lineSize > ApplicationLogger.MAX_FILE_SIZE)
                ApplicationLogger.startNextSessionPart();

            fse.appendFileSync(ApplicationLogger.logFilePath, line, "utf-8");
            ApplicationLogger.currentFileSize += lineSize;
        }
        catch (error)
        {
            ApplicationLogger.originalConsole.error("Could not write an application log entry:", error);
        }
    }

    static startOperation(source: string, name: string, details?: unknown): ApplicationLogOperation {
        const startedAt = Date.now();
        let finished = false;

        ApplicationLogger.info(source, `${name} started.`, details);

        const finish = (callback: () => void) => {
            if (finished)
                return;

            finished = true;
            callback();
        };

        return Object.freeze({
            complete(resultDetails?: unknown) {
                finish(() => {
                    ApplicationLogger.info(source, `${name} completed in ${Date.now() - startedAt} ms.`, resultDetails);
                });
            },
            completeWithWarnings(resultDetails?: unknown) {
                finish(() => {
                    ApplicationLogger.warning(source, `${name} completed with warnings in ${Date.now() - startedAt} ms.`, resultDetails);
                });
            },
            fail(error: unknown) {
                finish(() => {
                    ApplicationLogger.error(source, `${name} failed after ${Date.now() - startedAt} ms.`, error);
                });
            }
        });
    }

    static isWriteRequest(value: unknown): value is ApplicationLogWriteRequest {
        if (!TypeCheck.isRecord(value))
            return false;

        return (
            ApplicationLogger.isSeverity(value.severity) &&
            TypeCheck.isValidString(value.source, 80) &&
            TypeCheck.isValidString(value.message, 4_000) &&
            (
                value.details === undefined ||
                TypeCheck.isString(value.details, 20_000)
            )
        );
    }

    static hasLoggedError(error: unknown): boolean {
        return Boolean(
            error &&
            (typeof error === "object" || typeof error === "function") &&
            ApplicationLogger.loggedErrors.has(error as object)
        );
    }

    static getCurrentLogFilePath(): string {
        if (!ApplicationLogger.initialized || !ApplicationLogger.logFilePath)
            throw new Error("Application logging is not initialized.");

        return ApplicationLogger.logFilePath;
    }

    private static async pruneOldLogFiles() {
        const fileNames = await fse.readdir(ApplicationLogger.logDirectory);

        const candidates = await Promise.all(
            fileNames
                .filter((fileName) => /^application-[0-9A-Za-z_-]+(?:\.part-\d+)?\.jsonl$/.test(fileName))
                .map(async (fileName) => {
                    const filePath = path.join(ApplicationLogger.logDirectory, fileName);
                    const stats = await fse.stat(filePath);

                    return {
                        filePath,
                        modifiedAt: stats.mtimeMs
                    }
                })
        );

        candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);

        const obsoleteFiles = candidates.slice(ApplicationLogger.MAX_RETAINED_FILES - 1);
        await Promise.all(obsoleteFiles.map(({ filePath }) => fse.rm(filePath, { force: true })));
    }

    private static startNextSessionPart() {
        ApplicationLogger.sessionPart++;
        ApplicationLogger.logFilePath = Paths.getLogFilePath(ApplicationLogger.sessionId, ApplicationLogger.sessionPart);
        ApplicationLogger.currentFileSize = 0;
    }

    private static installConsoleCapture() {
        if (ApplicationLogger.consoleCaptureInstalled)
            return;

        ApplicationLogger.consoleCaptureInstalled = true;

        console.debug = (...args: unknown[]) => {
            ApplicationLogger.originalConsole.debug(...args);
            ApplicationLogger.captureConsoleEntry("debug", args);
        };

        console.info = (...args: unknown[]) => {
            ApplicationLogger.originalConsole.info(...args);
            ApplicationLogger.captureConsoleEntry("info", args);
        };

        console.log = (...args: unknown[]) => {
            ApplicationLogger.originalConsole.log(...args);
            ApplicationLogger.captureConsoleEntry("info", args);
        };

        console.warn = (...args: unknown[]) => {
            ApplicationLogger.originalConsole.warn(...args);
            ApplicationLogger.captureConsoleEntry("warning", args);
        };

        console.error = (...args: unknown[]) => {
            ApplicationLogger.originalConsole.error(...args);
            ApplicationLogger.captureConsoleEntry("error", args);
        };
    }

    private static installProcessDiagnostics() {
        process.on("warning", (warning) => {
            ApplicationLogger.write("warning", "Node.js", warning.message, warning.stack);
        });

        process.on("unhandledRejection", (reason) => {
            ApplicationLogger.error("Main process", "An unhandled promise rejection occurred.", reason);
        });

        process.on("uncaughtExceptionMonitor", (error, origin) => {
            ApplicationLogger.write("error", "Main process", `An uncaught exception occurred from ${origin}.`, ApplicationLogger.formatDetails(error));
        });
    }

    private static captureConsoleEntry(severity: ApplicationLogSeverity, args: readonly unknown[]) {
        const message = args.map((value) => {
            if (value instanceof Error)
                return `${value.name}: ${value.message}`;
            if (typeof value === "string")
                return value;

            return inspect(value, {
                depth: 3,
                breakLength: 160,
                maxArrayLength: 30
            });
        }).join(" ");

        const errors = args.filter((value): value is Error => value instanceof Error);
        const details = errors.length > 0
            ? errors.map((error) => ApplicationLogger.formatDetails(error)).filter(Boolean).join("\n\n")
            : undefined;

        ApplicationLogger.write(severity, "Main process", message, details);
    }

    private static formatDetails(value: unknown): string | undefined {
        if (value === undefined || value === null)
            return undefined;

        if (value instanceof Error)
        {
            return inspect(value, {
                depth: 6,
                breakLength: 160
            }).slice(0, 20_000);
        }

        if (typeof value === "string")
            return value.trim().slice(0, 20_000) || undefined;

        return inspect(value, {
            depth: 6,
            breakLength: 160,
            maxArrayLength: 100
        }).slice(0, 20_000);
    }

    private static redactSensitiveData(value: string): string {
        let redacted = value;

        const githubToken = process.env.LORPLUS_GITHUB_TOKEN?.trim();
        if (githubToken)
            redacted = redacted.replaceAll(githubToken, "[REDACTED]");

        redacted = redacted
            .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+)\b/g, "[REDACTED]")
            .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
            .replace(/([?&](?:password|passphrase|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret)=)[^&#\s"']*/gi, "$1[REDACTED]")
            .replace(/((?:"|')?authorization(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,}]+)/gi, "$1[REDACTED]")
            .replace(
                /((?:"|')?(?:password|passphrase|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s}\]&]+)/gi,
                "$1[REDACTED]"
            );

        return ApplicationLogger.redactHomeDirectory(redacted);
    }

    private static redactHomeDirectory(value: string): string {
        const homeDirectory = homedir();
        if (!homeDirectory)
            return value;

        return [homeDirectory, homeDirectory.replaceAll("\\", "/")].reduce((result, candidate) => {
            const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return result.replace(new RegExp(escaped, "gi"), "%USERPROFILE%");
        }, value);
    }

    private static isLogEntry(value: unknown): value is ApplicationLogEntry {
        if (!TypeCheck.isRecord(value))
            return false;

        return (
            TypeCheck.isUuid(value.id) &&
            TypeCheck.isValidString(value.timestamp, 100) &&
            ApplicationLogger.isSeverity(value.severity) &&
            TypeCheck.isValidString(value.source, 100) &&
            TypeCheck.isValidString(value.message, 4_000) &&
            (
                value.details === undefined ||
                TypeCheck.isString(value.details, 20_000)
            )
        );
    }

    private static isSeverity(value: unknown): value is ApplicationLogSeverity {
        return (
            value === "debug" ||
            value === "info" ||
            value === "warning" ||
            value === "error"
        );
    }

    private static createSessionId(): string {
        return new Date().toISOString().replace(/[:.]/g, "-");
    }

    private static isIgnoredMessage(message: string): boolean {
        return message.includes("Passing args to a child process with shell option true can lead to security vulnerabilities");
    }

    private static normalizeText(value: string, maxLength: number, fallback: string): string {
        const normalized = value.trim();
        return (normalized || fallback).slice(0, maxLength);
    }
}
