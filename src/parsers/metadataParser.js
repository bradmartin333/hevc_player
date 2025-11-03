// Metadata Parser - Parses MP4/MOV metadata from keys and ilst boxes

export class MetadataParser {
    parseMetadata(keysView, ilstView) {
        try {
            // Parse keys from 'keys' box
            const keys = [];

            let offset = 0;
            const metadataSize = new DataView(keysView.buffer, offset, 4).getUint32(0, false);
            offset += 4;

            while (offset < keysView.byteLength) {
                const itemSize = new DataView(keysView.buffer, offset, 4).getUint32(0, false);
                offset += 4;
                const typeBytes = new Uint8Array(keysView.buffer, offset, 4);
                offset += 4;
                const type = String.fromCharCode(...typeBytes);
                const keySize = itemSize - 8;
                if (type === 'mdta') {
                    const dataBytes = new Uint8Array(keysView.buffer, offset, keySize);
                    const key = new TextDecoder('utf-8').decode(dataBytes);
                    keys.push(key.trim());
                }
                offset += keySize;
            }

            if (metadataSize !== keys.length) {
                console.warn('Keys metadata size mismatch:', metadataSize, 'vs parsed', keys.length);
            }

            // Parse values from 'ilst' box
            const values = {};
            offset = 0;

            while (offset < ilstView.byteLength) {
                const itemSize = new DataView(ilstView.buffer, offset, 4).getUint32(0, false);
                offset += 4;
                const index = new DataView(ilstView.buffer, offset, 4).getUint32(0, false);
                offset += 4;
                const dataSize = new DataView(ilstView.buffer, offset, 4).getUint32(0, false);
                offset += 4;
                const typeBytes = new Uint8Array(ilstView.buffer, offset, 4);
                offset += 4;
                // Skip standard data atom header (8 bytes)
                offset += 8;
                const type = String.fromCharCode(...typeBytes);
                const valueSize = dataSize - 16;
                if (type === 'data') {
                    const dataBytes = new Uint8Array(ilstView.buffer, offset, valueSize);
                    const value = new TextDecoder('utf-8').decode(dataBytes);
                    values[index - 1] = value;
                }
                offset += valueSize;

                // Check that the size matches itemSize
                if (dataSize + 8 !== itemSize) {
                    console.warn('Ilst item size mismatch at index', index, ':', itemSize, 'vs parsed', dataSize + 8);
                }
            }

            // Combine keys and values into metadata object
            const metadata = {};
            keys.forEach((key, i) => {
                metadata[key] = values[i] || '';
            });

            console.log('Parsed metadata:', metadata);
            return metadata;
        } catch (e) {
            console.error('Error parsing metadata:', e);
            return {};
        }
    }
}
