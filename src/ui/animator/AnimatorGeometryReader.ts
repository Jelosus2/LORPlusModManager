export type AnimatorGeometryComponentType =
    | "float32"
    | "uint16"
    | "uint32";

export type AnimatorGeometryArrayDefinition<
    TComponentType extends AnimatorGeometryComponentType =
        AnimatorGeometryComponentType
> = Readonly<{
    byteOffset: number;
    byteLength: number;
    count: number;
    componentType: TComponentType;
    components: number;
}>;

export type AnimatorFloat32GeometryDefinition =
    AnimatorGeometryArrayDefinition<"float32">;

export type AnimatorUint16GeometryDefinition =
    AnimatorGeometryArrayDefinition<"uint16">;

export type AnimatorUint32GeometryDefinition =
    AnimatorGeometryArrayDefinition<"uint32">;

export type AnimatorGeometryManifest = Readonly<{
    file: string;
    magic: string;
    byteLength: number;
}>;

export type AnimatorGeometryArray =
    | Float32Array
    | Uint16Array
    | Uint32Array;

export class AnimatorGeometryReader {
    private readonly MAGIC = "LORGEO1";
    private readonly HEADER_SIZE = 8;
    private readonly MAXIMUM_COMPONENTS = 16;
    private readonly buffer: ArrayBuffer;
    private readonly data: DataView;

    constructor(private readonly manifest: AnimatorGeometryManifest, binary: ArrayBuffer) {
        this.buffer = binary;
        this.data = new DataView(binary);

        this.validateEnvironment();
        this.validateManifest();
        this.validateHeader();
    }

    readFloat32(definition: AnimatorFloat32GeometryDefinition): Float32Array {
        this.validateDefinition(definition, "float32");

        return new Float32Array(this.buffer, definition.byteOffset, definition.count * definition.components);
    }

    readUint16(definition: AnimatorUint16GeometryDefinition): Uint16Array {
        this.validateDefinition(definition, "uint16");

        return new Uint16Array(this.buffer, definition.byteOffset, definition.count * definition.components);
    }

    readUint32(definition: AnimatorUint32GeometryDefinition): Uint32Array {
        this.validateDefinition(definition, "uint32");

        return new Uint32Array(this.buffer, definition.byteOffset, definition.count * definition.components);
    }

    read(definition: AnimatorGeometryArrayDefinition): AnimatorGeometryArray {
        switch (definition.componentType)
        {
            case "float32":
                return this.readFloat32(definition as AnimatorFloat32GeometryDefinition);
            case "uint16":
                return this.readUint16(definition as AnimatorUint16GeometryDefinition);
            case "uint32":
                return this.readUint32(definition as AnimatorUint32GeometryDefinition);
        }
    }

    validate(definition: AnimatorGeometryArrayDefinition) {
        this.validateDefinition(definition, definition.componentType);
    }

    private validateManifest() {
        if (this.manifest.file !== "geometry.bin")
            throw new Error("The Animator geometry file name is invalid.");
        if (this.manifest.magic !== this.MAGIC)
            throw new Error("The Animator geometry magic value is invalid.");

        if (
            !Number.isSafeInteger(this.manifest.byteLength) ||
            this.manifest.byteLength < this.HEADER_SIZE ||
            this.manifest.byteLength !== this.buffer.byteLength
        )
        {
            throw new Error("The Animator geometry binary size is invalid.");
        }
    }

    private validateHeader() {
        const expected = [
            0x4c, 0x4f, 0x52,
            0x47, 0x45, 0x4f,
            0x31, 0x00
        ];

        for (let i = 0; i < expected.length; i++)
        {
            if (this.data.getUint8(i) !== expected[i])
                throw new Error("The Animator geometry binary header is invalid.");
        }
    }

    private validateDefinition(
        definition: AnimatorGeometryArrayDefinition,
        expectedType: AnimatorGeometryComponentType
    ) {
        if (definition.componentType !== expectedType)
            throw new Error(`Expected ${expectedType} geometry but received ${definition.componentType}.`);

        if (
            !Number.isSafeInteger(definition.byteOffset) ||
            !Number.isSafeInteger(definition.byteLength) ||
            !Number.isSafeInteger(definition.count) ||
            !Number.isSafeInteger(definition.components) ||
            definition.byteOffset < this.HEADER_SIZE ||
            definition.byteLength <= 0 ||
            definition.count <= 0 ||
            definition.components <= 0 ||
            definition.components > this.MAXIMUM_COMPONENTS
        )
        {
            throw new Error("An Animator geometry array has invalid metadata.");
        }

        const componentSize = this.getComponentSize(definition.componentType);
        const valueCount = definition.count * definition.components;
        const expectedByteLength = valueCount * componentSize;
        const endOffset = definition.byteOffset + definition.byteLength;

        if (
            !Number.isSafeInteger(valueCount) ||
            !Number.isSafeInteger(expectedByteLength) ||
            !Number.isSafeInteger(endOffset) ||
            definition.byteLength !== expectedByteLength ||
            endOffset > this.buffer.byteLength
        )
        {
            throw new Error("An Animator geometry array is out of bounds.");
        }

        if (definition.byteOffset % componentSize !== 0)
            throw new Error("An Animator geometry array is misaligned.");
    }

    private getComponentSize(componentType: AnimatorGeometryComponentType): number {
        switch (componentType)
        {
            case "float32":
            case "uint32":
                return 4;
            case "uint16":
                return 2;
        }
    }

    private validateEnvironment() {
        const testBuffer = new ArrayBuffer(4);
        const words = new Uint32Array(testBuffer);
        const bytes = new Uint8Array(testBuffer);

        words[0] = 0x01020304;

        if (bytes[0] !== 0x04)
            throw new Error("Animator geometry requires a little-endian environment.");
    }
}
