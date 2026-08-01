import { TypeCheck } from "./TypeCheck.js";

export class UserFacingError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "UserFacingError";
    }
}

export class ErrorUtils {
    static getUserErrorMessage(error: unknown, fallback: string): string {
        const message = this.extractUserMessage(error);
        return (message || fallback).trim();
    }

    static combineWithCause(message: string, cause: unknown, fallbackDetail = ""): string {
        const primary = message.trim();
        const detail = this.getUserErrorMessage(cause, fallbackDetail);

        if (!detail || primary.toLowerCase().includes(detail.toLowerCase()))
            return primary;

        return `${primary} ${detail}`;
    }

    static withContext(message: string, cause: unknown, fallbackDetail = ""): UserFacingError {
        return new UserFacingError(this.combineWithCause(message, cause, fallbackDetail), { cause });
    }

    static getFsErrorMessage(error: unknown, subject = "The file or directory"): string {
        const code = this.findErrorCode(error);

        switch (code)
        {
            case "ENOENT":
                return `${subject} no longer exists.`;
            case "ENOTDIR":
                return `Part of the path to ${subject.toLowerCase()} is not a directory.`;
            case "EISDIR":
                return `${subject} is a directory instead of a file.`;
            case "EACCES":
            case "EPERM":
                return `Access to ${subject.toLowerCase()} was denied. Check its permissions or whether administrator privileges are required.`;
            case "EBUSY":
                return `${subject} is currently being used by another program.`;
            case "ENOSPC":
                return "There is not enough free disk space to complete the operation.";
            case "EEXIST":
                return `${subject} already exists.`;
            case "EROFS":
                return `${subject} is on a read-only filesystem.`;
            case "ENAMETOOLONG":
                return `The path for ${subject.toLowerCase()} is too long.`;
            case "EMFILE":
            case "ENFILE":
                return "Too many files are currently open. Close other applications and try again.";
            case "EXDEV":
                return "The files could not be moved because the source and destination use different filesystems.";
            default:
                return "";
        }
    }

    private static extractUserMessage(error: unknown): string {
        if (error instanceof UserFacingError)
            return error.message.trim();

        if (error instanceof AggregateError)
        {
            const messages = [...new Set(error.errors.map((entry) => this.extractUserMessage(entry)).filter(Boolean))];
            if (messages.length === 0)
                return "";

            const visibleMessages = messages.slice(0, 3);
            const remaining = messages.length - visibleMessages.length;

            return remaining > 0
                ? `${visibleMessages.join(" ")} and ${remaining} additional errors occurred.`
                : visibleMessages.join(" ");
        }

        const systemMessage = this.getDirectSystemErrorMessage(error);
        if (systemMessage)
            return systemMessage;

        if (typeof error === "string")
            return error.trim();

        if (!(error instanceof Error))
            return "";

        if (error.name === "TypeError" || error.name === "ReferenceError" || error.name === "SyntaxError" || error.name === "RangeError")
            return "";

        if (error.name === "AbortError" || /timed?\s*out/i.test(error.message))
            return "The operation timed out.";

        if (/fetch failed/i.test(error.message) || /network request failed/i.test(error.message))
            return this.getNetworkErrorMessage(error) || "The server could not be reached. Check your internet connection and try again.";

        return error.message.trim();
    }

    private static getDirectSystemErrorMessage(error: unknown): string {
        if (!TypeCheck.isNodeError(error) || typeof error.code !== "string")
            return "";

        switch (error.code)
        {
            case "SQLITE_BUSY":
            case "SQLITE_LOCKED":
                return "The database is currently being used by another operation.";
            case "SQLITE_READONLY":
                return "The database is read-only and could not be updated.";
            case "SQLITE_FULL":
                return "The database could not be updated because the disk is full.";
            case "SQLITE_CORRUPT":
            case "SQLITE_NOTADB":
                return "The local database is damaged or is not a valid SQLite database.";
            case "SQLITE_IOERR":
                return "A disk error occurred while accessing the local mod database.";
            case "SQLITE_CONSTRAINT_UNIQUE":
                return "The database rejected a duplicate mod value.";
            case "SQLITE_CONSTRAINT_FOREIGNKEY":
                return "The database contains inconsistent mod information.";
        }

        return this.getFsErrorMessage(error);
    }

    private static getNetworkErrorMessage(error: unknown): string {
        const code = this.findErrorCode(error);

        switch (code)
        {
            case "ENOTFOUND":
            case "EAI_AGAIN":
                return "The server address could not be resolved. Check your internet connection.";
            case "ECONNREFUSED":
                return "The server refused the connection.";
            case "ECONNRESET":
                return "The connection was interrupted by the server.";
            case "ETIMEDOUT":
                return "The network request timed out.";
            case "CERT_HAS_EXPIRED":
            case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
            case "SELF_SIGNED_CERT_IN_CHAIN":
                return "The server's security certificate could not be verified.";
            default:
                return "";
        }
    }

    private static findErrorCode(error: unknown): string {
        const visited = new Set<unknown>();
        let current = error;

        while (current && !visited.has(current))
        {
            visited.add(current);

            if (TypeCheck.isNodeError(current) && typeof current.code === "string")
                return current.code;

            current = current instanceof Error
                ? current.cause
                : undefined;
        }

        return "";
    }
}
