export class UnityCrc32 {
    private static readonly CRC_TABLE = new Uint32Array(256);
    private static readonly encoder = new TextEncoder();

    static {
        for (let i = 0; i < UnityCrc32.CRC_TABLE.length; i++)
        {
            let value = i;

            for (let bit = 0; bit < 8; bit++)
            {
                value = (value & 1) !== 0
                    ? 0xedb88320 ^ (value >>> 1)
                    : value >>> 1;
            }

            UnityCrc32.CRC_TABLE[i] = value >>> 0;
        }
    }

    static generateCrc(value: string): number {
        let crc = 0xffffffff;

        for (const byte of UnityCrc32.encoder.encode(value))
            crc = UnityCrc32.CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);

        return (crc ^ 0xffffffff) >>> 0;
    }
}
