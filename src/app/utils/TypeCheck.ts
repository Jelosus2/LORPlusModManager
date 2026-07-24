export class TypeCheck {
    static isRecord(value: unknown): value is Record<string, unknown> {
        return Boolean(value && typeof value === "object" && !Array.isArray(value));
    }

    static isNodeError(value: unknown): value is NodeJS.ErrnoException {
        return Boolean(value && typeof value === "object" && "code" in value);
    }
}
