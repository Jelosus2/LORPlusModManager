import type { ApplicationLogSeverity, ApplicationLogWriteRequest } from "../../shared/application";

type ConsoleOutput = (...args: unknown[]) => void;

export class RendererLogger {
    private static readonly MAX_MESSAGE_LENGTH = 4000;
    private static readonly MAX_DETAILS_LENGTH = 20_000;
    private static readonly originalConsole = {
        debug: console.debug.bind(console),
        info: console.info.bind(console),
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
    };

    private static installed = false;
    private static persistenceFailureReported = false;

    static install() {
        if (RendererLogger.installed)
            return;

        RendererLogger.installed = true;

        console.debug = (...args: unknown[]) => {
            RendererLogger.captureConsole("debug", RendererLogger.originalConsole.debug, args);
        };

        console.info = (...args: unknown[]) => {
            RendererLogger.captureConsole("info", RendererLogger.originalConsole.info, args);
        };

        console.log = (...args: unknown[]) => {
            RendererLogger.captureConsole("info", RendererLogger.originalConsole.log, args);
        };

        console.warn = (...args: unknown[]) => {
            RendererLogger.captureConsole("warning", RendererLogger.originalConsole.warn, args);
        };

        console.error = (...args: unknown[]) => {
            RendererLogger.captureConsole("error", RendererLogger.originalConsole.error, args);
        };

        window.addEventListener("error", (event) => {
            const location = event.filename
                ? `${event.filename}:${event.lineno}:${event.colno}`
                : undefined;

            const errorDetails = event.error instanceof Error
                ? RendererLogger.formatError(event.error)
                : undefined;

            const details = [errorDetails, location]
                .filter((value): value is string => Boolean(value))
                .join("\n\n");

            RendererLogger.persist({
                severity: "error",
                source: "Window",
                message: RendererLogger.truncate(event.message || "An uncaught renderer error occurred.", RendererLogger.MAX_MESSAGE_LENGTH),
                ...(details ? { details: RendererLogger.truncate(details, RendererLogger.MAX_DETAILS_LENGTH) } : {})
            });
        });

        window.addEventListener("unhandledrejection", (event) => {
            const formatted = RendererLogger.formatArguments([event.reason]);

            RendererLogger.persist({
                severity: "error",
                source: "Promise",
                message: RendererLogger.truncate(`Unhandled promise rejection: ${formatted.message}`, RendererLogger.MAX_MESSAGE_LENGTH),
                ...(formatted.details ? { details: formatted.details } : {})
            });
        });

        RendererLogger.persist({
            severity: "info",
            source: "Renderer",
            message: "Renderer logging initialized."
        });
    }

    static debug(source: string, message: string, details?: unknown) {
        RendererLogger.record("debug", source, message, details);
    }

    static info(source: string, message: string, details?: unknown) {
        RendererLogger.record("info", source, message, details);
    }

    static warning(source: string, message: string, details?: unknown) {
        RendererLogger.record("warning", source, message, details);
    }

    static error(source: string, message: string, error?: unknown) {
        RendererLogger.record("error", source, message, error);
    }

    private static record(severity: ApplicationLogSeverity, source: string, message: string, details?: unknown) {
        const output = severity === "debug"
            ? RendererLogger.originalConsole.debug
            : severity === "info"
                ? RendererLogger.originalConsole.info
                : severity === "warning"
                    ? RendererLogger.originalConsole.warn
                    : RendererLogger.originalConsole.error;

        if (details === undefined)
            output(`[${source}] ${message}`);
        else
            output(`[${source}] ${message}`, details);

        const formattedDetails = RendererLogger.formatDetails(details);

        RendererLogger.persist({
            severity,
            source: RendererLogger.truncate(source, 80),
            message: RendererLogger.truncate(message, RendererLogger.MAX_MESSAGE_LENGTH),
            ...(formattedDetails ? { details: formattedDetails } : {})
        });
    }

    private static captureConsole(severity: ApplicationLogSeverity, output: ConsoleOutput, args: readonly unknown[]) {
        output(...args);

        const formatted = RendererLogger.formatArguments(args);

        RendererLogger.persist({
            severity,
            source: "Console",
            message: formatted.message,
            ...(formatted.details ? { details: formatted.details } : {})
        });
    }

    private static persist(request: ApplicationLogWriteRequest) {
        void window.app.writeApplicationLog(request).then(() => { RendererLogger.persistenceFailureReported = false; }, (error: unknown) => {
            if (RendererLogger.persistenceFailureReported)
                return;

            RendererLogger.persistenceFailureReported = true;
            RendererLogger.originalConsole.error("Could not persist a renderer log entry:", error);
        });
    }

    private static formatArguments(args: readonly unknown[]): { message: string; details?: string } {
        const message = RendererLogger.truncate(
            args.map((value) => RendererLogger.formatValue(value)).join(" ").trim() || "Renderer console message.",
            RendererLogger.MAX_MESSAGE_LENGTH
        );

        const details = args
            .filter((value): value is Error => value instanceof Error)
            .map((error) => RendererLogger.formatError(error))
            .join("\n\n");

        return details
            ? { message, details: RendererLogger.truncate(details, RendererLogger.MAX_DETAILS_LENGTH) }
            : { message };
    }

    private static formatDetails(value: unknown): string | undefined {
        if (value === undefined || value === null)
            return undefined;

        const formatted = value instanceof Error
            ? RendererLogger.formatError(value)
            : RendererLogger.formatValue(value);

        return RendererLogger.truncate(formatted, RendererLogger.MAX_DETAILS_LENGTH) || undefined;
    }

    private static formatError(error: Error): string {
        const cause = error.cause !== undefined
            ? `\nCaused by: ${RendererLogger.formatValue(error.cause)}`
            : "";

        return `${error.stack ?? `${error.name}: ${error.message}`}${cause}`;
    }

    private static formatValue(value: unknown): string {
        if (value instanceof Error)
            return `${value.name}: ${value.message}`;
        if (typeof value === "string")
            return value;
        if (typeof value === "bigint")
            return `${value}n`;

        const seen = new WeakSet<object>();

        try
        {
            const serialized = JSON.stringify(value, (_key, nestedValue) => {
                if (typeof nestedValue === "bigint")
                    return `${nestedValue}n`;

                if (nestedValue instanceof Error)
                {
                    return {
                        name: nestedValue.name,
                        message: nestedValue.message,
                        stack: nestedValue.stack
                    };
                }

                if (nestedValue && typeof nestedValue === "object")
                {
                    if (seen.has(nestedValue))
                        return "[Circular]";

                    seen.add(nestedValue);
                }

                return nestedValue;
            });

            return serialized ?? String(value);
        }
        catch
        {
            return String(value);
        }
    }

    private static truncate(value: string, maximumLength: number): string {
        return value.slice(0, maximumLength);
    }
}
