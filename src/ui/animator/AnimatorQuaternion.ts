import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export class AnimatorQuaternion {
    private static readonly EPSILON = 0.000001;

    static createIdentity(): number[] {
        return [0, 0, 0, 1];
    }

    static normalized(value: readonly number[]): number[] {
        const result = AnimatorQuaternion.createIdentity();

        AnimatorQuaternion.normalizeInto(result, value);
        return result;
    }

    static normalizeInto(destination: number[], value: readonly number[]) {
        AnimatorRuntimeUtils.requireFiniteVector(value, 4, "Quaternion");

        if (destination.length !== 4)
            throw new Error("The quaternion destination is invalid.");

        const x = value[0];
        const y = value[1];
        const z = value[2];
        const w = value[3];
        const magnitude = Math.hypot(x, y, z, w);

        if (magnitude <= AnimatorQuaternion.EPSILON)
        {
            destination[0] = 0;
            destination[1] = 0;
            destination[2] = 0;
            destination[3] = 1;
            return;
        }

        destination[0] = x / magnitude;
        destination[1] = y / magnitude;
        destination[2] = z / magnitude;
        destination[3] = w / magnitude;
    }

    static multiplied(left: readonly number[], right: readonly number[]): number[] {
        const result = AnimatorQuaternion.createIdentity();

        AnimatorQuaternion.multiplyInto(result, left, right);
        return result;
    }

    static multiplyInto(destination: number[], left: readonly number[], right: readonly number[]) {
        AnimatorRuntimeUtils.requireFiniteVector(left, 4, "Left quaternion");
        AnimatorRuntimeUtils.requireFiniteVector(right, 4, "Right quaternion");

        if (destination.length !== 4)
            throw new Error("The quaternion destination is invalid.");

        const lx = left[0];
        const ly = left[1];
        const lz = left[2];
        const lw = left[3];
        const rx = right[0];
        const ry = right[1];
        const rz = right[2];
        const rw = right[3];

        destination[0] = lw * rx + lx * rw + ly * rz - lz * ry;
        destination[1] = lw * ry - lx * rz + ly * rw + lz * rx;
        destination[2] = lw * rz + lx * ry - ly * rx + lz * rw;
        destination[3] = lw * rw - lx * rx - ly * ry - lz * rz;

        AnimatorQuaternion.normalizeInto(destination, destination);
    }

    static inverted(value: readonly number[]): number[] {
        AnimatorRuntimeUtils.requireFiniteVector(value, 4, "Quaternion");

        const x = value[0];
        const y = value[1];
        const z = value[2];
        const w = value[3];
        const magnitudeSquared = x * x + y * y + z * z + w * w;

        if (magnitudeSquared <= AnimatorQuaternion.EPSILON)
            throw new Error("A zero-length quaternion cannot be inverted.");

        return [
            -x / magnitudeSquared,
            -y / magnitudeSquared,
            -z / magnitudeSquared,
            w / magnitudeSquared
        ];
    }

    static angleAxis(angleDegrees: number, axis: readonly number[]): number[] {
        if (!Number.isFinite(angleDegrees))
            throw new Error("A quaternion angle is invalid.");

        const normalizedAxis = AnimatorQuaternion.normalizeVector3(axis, "Quaternion axis");
        const halfAngle = angleDegrees * Math.PI / 360;
        const sine = Math.sin(halfAngle);

        return [
            normalizedAxis[0] * sine,
            normalizedAxis[1] * sine,
            normalizedAxis[2] * sine,
            Math.cos(halfAngle)
        ];
    }

    static lookRotation(forward: readonly number[], up: readonly number[]): number[] {
        const normalizedForward = AnimatorQuaternion.normalizeVector3(forward, "Look-rotation forward vector");
        const right = AnimatorQuaternion.normalizeVector3(AnimatorQuaternion.cross(up, normalizedForward), "Look-rotation right vector");
        const correctedUp = AnimatorQuaternion.cross(normalizedForward, right);

        const m00 = right[0];
        const m01 = correctedUp[0];
        const m02 = normalizedForward[0];
        const m10 = right[1];
        const m11 = correctedUp[1];
        const m12 = normalizedForward[1];
        const m20 = right[2];
        const m21 = correctedUp[2];
        const m22 = normalizedForward[2];

        const trace = m00 + m11 + m22;

        let x: number;
        let y: number;
        let z: number;
        let w: number;

        if (trace > 0)
        {
            const scale = Math.sqrt(trace + 1) * 2;

            x = (m21 - m12) / scale;
            y = (m02 - m20) / scale;
            z = (m10 - m01) / scale;
            w = scale / 4;
        }
        else if (m00 > m11 && m00 > m22)
        {
            const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;

            x = scale / 4;
            y = (m01 + m10) / scale;
            z = (m02 + m20) / scale;
            w = (m21 - m12) / scale;
        }
        else if (m11 > m22)
        {
            const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;

            x = (m01 + m10) / scale;
            y = scale / 4;
            z = (m12 + m21) / scale;
            w = (m02 - m20) / scale;
        }
        else
        {
            const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;

            x = (m02 + m20) / scale;
            y = (m12 + m21) / scale;
            z = scale / 4;
            w = (m10 - m01) / scale;
        }

        return AnimatorQuaternion.normalized([x, y, z, w]);
    }

    private static normalizeVector3(value: readonly number[], context: string): number[] {
        AnimatorRuntimeUtils.requireFiniteVector(value, 3, context);

        const x = value[0];
        const y = value[1];
        const z = value[2];
        const magnitude = Math.hypot(x, y, z);

        if (magnitude <= AnimatorQuaternion.EPSILON)
            throw new Error(`${context} has zero length.`);

        return [
            x / magnitude,
            y / magnitude,
            z / magnitude
        ];
    }

    private static cross(left: readonly number[], right: readonly number[]): number[] {
        return [
            left[1] * right[2] - left[2] * right[1],
            left[2] * right[0] - left[0] * right[2],
            left[0] * right[1] - left[1] * right[0]
        ];
    }
}
