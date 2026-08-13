import { AnimatorRuntimeUtils } from "./AnimatorRuntimeUtils";

export type AnimatorMatrix4Array = Float64Array;

export type AnimatorMatrix4Source =
    | Float32Array
    | Float64Array;

export class AnimatorMatrix4 {
    private static readonly MATRIX_COMPONENT_COUNT = 16;
    private static readonly QUATERNION_EPSILON = 0.00000001;

    static createAnimatorMatrix4(): AnimatorMatrix4Array {
        const result = new Float64Array(AnimatorMatrix4.MATRIX_COMPONENT_COUNT);

        result[0] = 1;
        result[5] = 1;
        result[10] = 1;
        result[15] = 1;

        return result;
    }

    static copyAnimatorMatrix4(destination: AnimatorMatrix4Array, source: AnimatorMatrix4Source) {
        AnimatorMatrix4.requireMatrix(destination, "Destination matrix");
        AnimatorMatrix4.requireMatrix(source, "Source matrix");

        destination.set(source);
    }

    static multiplyAnimatorMatrix4(result: AnimatorMatrix4Array, left: AnimatorMatrix4Source, right: AnimatorMatrix4Source) {
        AnimatorMatrix4.requireMatrix(result, "Result matrix");
        AnimatorMatrix4.requireMatrix(left, "Left matrix");
        AnimatorMatrix4.requireMatrix(right, "Right matrix");

        const l00 = left[0];
        const l01 = left[1];
        const l02 = left[2];
        const l03 = left[3];
        const l10 = left[4];
        const l11 = left[5];
        const l12 = left[6];
        const l13 = left[7];
        const l20 = left[8];
        const l21 = left[9];
        const l22 = left[10];
        const l23 = left[11];
        const l30 = left[12];
        const l31 = left[13];
        const l32 = left[14];
        const l33 = left[15];

        const r00 = right[0];
        const r01 = right[1];
        const r02 = right[2];
        const r03 = right[3];
        const r10 = right[4];
        const r11 = right[5];
        const r12 = right[6];
        const r13 = right[7];
        const r20 = right[8];
        const r21 = right[9];
        const r22 = right[10];
        const r23 = right[11];
        const r30 = right[12];
        const r31 = right[13];
        const r32 = right[14];
        const r33 = right[15];

        result[0] = l00 * r00 + l01 * r10 + l02 * r20 + l03 * r30;
        result[1] = l00 * r01 + l01 * r11 + l02 * r21 + l03 * r31;
        result[2] = l00 * r02 + l01 * r12 + l02 * r22 + l03 * r32;
        result[3] = l00 * r03 + l01 * r13 + l02 * r23 + l03 * r33;

        result[4] = l10 * r00 + l11 * r10 + l12 * r20 + l13 * r30;
        result[5] = l10 * r01 + l11 * r11 + l12 * r21 + l13 * r31;
        result[6] = l10 * r02 + l11 * r12 + l12 * r22 + l13 * r32;
        result[7] = l10 * r03 + l11 * r13 + l12 * r23 + l13 * r33;

        result[8] = l20 * r00 + l21 * r10 + l22 * r20 + l23 * r30;
        result[9] = l20 * r01 + l21 * r11 + l22 * r21 + l23 * r31;
        result[10] = l20 * r02 + l21 * r12 + l22 * r22 + l23 * r32;
        result[11] = l20 * r03 + l21 * r13 + l22 * r23 + l23 * r33;

        result[12] = l30 * r00 + l31 * r10 + l32 * r20 + l33 * r30;
        result[13] = l30 * r01 + l31 * r11 + l32 * r21 + l33 * r31;
        result[14] = l30 * r02 + l31 * r12 + l32 * r22 + l33 * r32;
        result[15] = l30 * r03 + l31 * r13 + l32 * r23 + l33 * r33;
    }

    static setAnimatorMatrix4FromTrs(result: AnimatorMatrix4Array, position: readonly number[], rotation: readonly number[], scale: readonly number[]) {
        AnimatorMatrix4.requireMatrix(result, "TRS result matrix");
        AnimatorRuntimeUtils.requireFiniteVector(position, 3, "Transform position");
        AnimatorRuntimeUtils.requireFiniteVector(rotation, 4, "Transform rotation");
        AnimatorRuntimeUtils.requireFiniteVector(scale, 3, "Transform scale");

        let x = rotation[0];
        let y = rotation[1];
        let z = rotation[2];
        let w = rotation[3];

        const quaternionLength = Math.hypot(x, y, z, w);
        if (quaternionLength <= AnimatorMatrix4.QUATERNION_EPSILON)
            throw new Error("A Transform contains a zero-length rotation quaternion.");

        x /= quaternionLength;
        y /= quaternionLength;
        z /= quaternionLength;
        w /= quaternionLength;

        const x2 = x + x;
        const y2 = y + y;
        const z2 = z + z;

        const xx = x * x2;
        const xy = x * y2;
        const xz = x * z2;
        const yy = y * y2;
        const yz = y * z2;
        const zz = z * z2;
        const wx = w * x2;
        const wy = w * y2;
        const wz = w * z2;

        const sx = scale[0];
        const sy = scale[1];
        const sz = scale[2];

        result[0] = (1 - (yy + zz)) * sx;
        result[1] = (xy - wz) * sy;
        result[2] = (xz + wy) * sz;
        result[3] = position[0];

        result[4] = (xy + wz) * sx;
        result[5] = (1 - (xx + zz)) * sy;
        result[6] = (yz - wx) * sz;
        result[7] = position[1];

        result[8] = (xz - wy) * sx;
        result[9] = (yz + wx) * sy;
        result[10] = (1 - (xx + yy)) * sz;
        result[11] = position[2];

        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
    }

    static writeTransformedAnimatorPoint3(
        destination: Float32Array | Float64Array,
        destinationOffset: number,
        matrix: AnimatorMatrix4Array,
        x: number,
        y: number,
        z: number
    ) {
        destination[destinationOffset] =
            matrix[0] * x +
            matrix[1] * y +
            matrix[2] * z +
            matrix[3];

        destination[destinationOffset + 1] =
            matrix[4] * x +
            matrix[5] * y +
            matrix[6] * z +
            matrix[7];

        destination[destinationOffset + 2] =
            matrix[8] * x +
            matrix[9] * y +
            matrix[10] * z +
            matrix[11];
    }

    static writeTransformedAnimatorVector3(
        destination: Float32Array | Float64Array,
        destinationOffset: number,
        matrix: AnimatorMatrix4Array,
        x: number,
        y: number,
        z: number
    ) {
        destination[destinationOffset] =
            matrix[0] * x +
            matrix[1] * y +
            matrix[2] * z;

        destination[destinationOffset + 1] =
            matrix[4] * x +
            matrix[5] * y +
            matrix[6] * z;

        destination[destinationOffset + 2] =
            matrix[8] * x +
            matrix[9] * y +
            matrix[10] * z;
    }

    private static requireMatrix(matrix: AnimatorMatrix4Source, context: string) {
        if (matrix.length !== AnimatorMatrix4.MATRIX_COMPONENT_COUNT)
            throw new Error(`${context} has an invalid size.`);
    }
}
