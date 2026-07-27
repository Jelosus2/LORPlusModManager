export class TypeCheck {
    static isRecord(value: unknown): value is Record<string, unknown> {
        return Boolean(value && typeof value === "object" && !Array.isArray(value));
    }

    static isNodeError(value: unknown): value is NodeJS.ErrnoException {
        return Boolean(value && typeof value === "object" && "code" in value);
    }

    static isValidString(value: unknown, maxLength?: number): value is string {
        if (typeof value !== "string")
            return false;
        if (maxLength === undefined)
            return true;

        const trimmedLength = value.trim().length;
        return trimmedLength > 0 && trimmedLength <= maxLength;
    }

    static isValidArray(value: unknown, maxLength?: number): value is unknown[] {
        if (!Array.isArray(value))
            return false;
        if (maxLength === undefined)
            return true;

        return value.length > 0 && value.length <= maxLength;
    }

    static isValidInteger(value: unknown, checkSafety = false, positiveCheck = true): value is number {
        if (typeof value !== "number" || !Number.isInteger(value))
            return false;
        if (checkSafety && !Number.isSafeInteger(value))
            return false;
        if (positiveCheck && value <= 0)
            return false;

        return true;
    }

    static isBoolean(value: unknown): value is boolean {
        return typeof value === "boolean";
    }
}
