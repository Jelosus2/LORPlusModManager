export class ErrorUtils {
    static getUserErrorMessage(error: unknown, fallback: string): string {
        const extracted = ErrorUtils.extractMessage(error);
        if (!extracted)
            return fallback;

        const cleaned = ErrorUtils.removeErrorWrappers(extracted);
        if (!cleaned)
            return fallback;

        return this.systemErrorMessage(cleaned) ?? fallback;
    }

    private static extractMessage(error: unknown): string {
        if (typeof error === "string")
            return error;

        if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
            return error.message;

        return "";
    }

    private static removeErrorWrappers(message: string): string {
        let result = message.trim();

        result = result.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, "");
        result = result.replace(/^(?:Error|ModLibraryError|UnityWorkerError):\s*/i, "");

        return result.trim();
    }

    private static systemErrorMessage(message: string): string | null {
        if (/^(?:ENOENT|ENOTDIR)\b/i.test(message))
            return "A required file or directory no longer exists.";

        if (/^(?:EACCES|EPERM)\b/i.test(message))
            return "Access was denied. Check the folder permissions or run the mod manager as administrator if the action requires it.";

        if (/^ENOSPC\b/i.test(message))
            return "There is not enough free disk space to complete this action.";

        if (/^EBUSY\b/i.test(message))
            return "A required file or folder is currently in use. Close programs using it and try again.";

        if (/^EEXIST\b/i.test(message))
            return "A file or folder already exists at the destination.";

        if (/fetch failed/i.test(message) || /network request failed/i.test(message))
            return "The server could not be reached. Check your internet connection and try again.";

        if (/database is locked/i.test(message))
            return "The mod database is currently in use by another operation. Wait a moment and try again.";

        if (/^SqliteError:/i.test(message))
            return "The local mod database operation failed.";

        if (/^(?:TypeError|ReferenceError|SyntaxError|RangeError):/i.test(message) || /cannot read properties of/i.test(message))
            return null;

        return message;
    }
}
