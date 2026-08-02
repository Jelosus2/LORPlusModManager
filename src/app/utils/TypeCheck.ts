export class TypeCheck {
    static isRecord(value: unknown): value is Record<string, unknown> {
        return Boolean(value && typeof value === "object" && !Array.isArray(value));
    }

    static isNodeError(value: unknown): value is NodeJS.ErrnoException {
        return Boolean(value && typeof value === "object" && "code" in value);
    }

    static isString(value: unknown, maxLength?: number): value is string {
        return (
            typeof value === "string" &&
            (maxLength === undefined || value.length <= maxLength)
        );
    }

    static isValidString(value: unknown, maxLength?: number): value is string {
        return (
            typeof value === "string" &&
            value.trim().length > 0 &&
            (maxLength === undefined || value.length <= maxLength)
        );
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
        if (positiveCheck && value < 0)
            return false;

        return true;
    }

    static isBoolean(value: unknown): value is boolean {
        return typeof value === "boolean";
    }

    static isUuid(value: unknown): value is string {
        return (
            TypeCheck.isValidString(value) &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
        );
    }
}
