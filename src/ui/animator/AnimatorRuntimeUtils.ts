export type AnimatorRuntimeRecord<T = unknown> = Readonly<Record<string, T>>;

export class AnimatorRuntimeUtils {
    static requireRecord<T = unknown>(value: unknown, context: string): AnimatorRuntimeRecord<T> {
        if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new Error(`${context} must be an object.`);

        return value as AnimatorRuntimeRecord<T>;
    }

    static requireProperty<T>(object: AnimatorRuntimeRecord<T>, property: string, context: string): T {
        if (!Object.prototype.hasOwnProperty.call(object, property))
            throw new Error(`${context}.${property} is missing.`);

        return object[property];
    }

    static requireArrayProperty<T>(object: AnimatorRuntimeRecord<T>, property: string, context: string): readonly T[] {
        const value = AnimatorRuntimeUtils.requireProperty(object, property, context);

        if (!Array.isArray(value))
            throw new Error(`${context}.${property} must be an array.`);

        return value;
    }

    static requireFiniteNumberProperty<T>(object: AnimatorRuntimeRecord<T>, property: string, context: string): number {
        const value = AnimatorRuntimeUtils.requireProperty(object, property, context);

        if (typeof value !== "number" || !Number.isFinite(value))
            throw new Error(`${context}.${property} must be a finite number.`);

        return value;
    }

    static requireIntegerProperty<T>(object: AnimatorRuntimeRecord<T>, property: string, context: string): number {
        const value = AnimatorRuntimeUtils.requireFiniteNumberProperty(object, property, context);

        if (!Number.isInteger(value))
            throw new Error(`${context}.${property} must be an integer.`);

        return value;
    }

    static requireFiniteVector(value: readonly number[], expectedLength: number, context: string): readonly number[] {
        if (value.length !== expectedLength || value.some((component) => !Number.isFinite(component)))
            throw new Error(`${context} is invalid.`);

        return value;
    }

    static copyFiniteVector(destination: number[], source: readonly number[], expectedLength: number, context: string) {
        if (destination.length !== expectedLength || source.length !== expectedLength || source.some((component) => !Number.isFinite(component)))
            throw new Error(`${context} is invalid.`);

        for (let i = 0; i < expectedLength; i++)
            destination[i] = source[i];
    }

    static indexUniqueById<T extends Readonly<{ id: string }>>(values: readonly T[], typeName: string): Map<string, T> {
        const result = new Map<string, T>();

        for (const value of values) {
            if (result.has(value.id))
                throw new Error(`${typeName} "${value.id}" is duplicated.`);

            result.set(value.id, value);
        }

        return result;
    }

    static requireMaterialSlot(renderer: Readonly<{ materialIds: readonly unknown[] }>, materialSlot: number) {
        if (!Number.isInteger(materialSlot) || materialSlot < 0 || materialSlot >= renderer.materialIds.length)
            throw new Error("An animation targets an invalid material slot.");
    }

    static appendUniqueString(destination: string[], keys: Set<string>, value: string) {
        if (keys.has(value))
            return;

        keys.add(value);
        destination.push(value);
    }

    static requireNotDestroyed(destroyed: boolean, context: string) {
        if (destroyed)
            throw new Error(`${context} has already been destroyed.`);
    }

    static lerp(start: number, end: number, factor: number): number {
        return start + ((end - start) * factor);
    }

    static clamp01(value: number): number {
        return Math.min(1, Math.max(0, value));
    }
}
