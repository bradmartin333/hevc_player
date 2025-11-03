// SEI Parser - Extracts SEI data from HEVC/H.265 Annex-B streams

export class SEIParser {
    parseSEIFromAnnexB(data) {
        const seiData = [];
        let frameNumber = 0;
        let offset = 0;

        while (offset < data.length - 4) {
            // Find start code (0x00 0x00 0x00 0x01 or 0x00 0x00 0x01)
            if (data[offset] === 0x00 && data[offset + 1] === 0x00) {
                let startCodeLen = 0;
                if (data[offset + 2] === 0x00 && data[offset + 3] === 0x01) {
                    startCodeLen = 4;
                } else if (data[offset + 2] === 0x01) {
                    startCodeLen = 3;
                } else {
                    offset++;
                    continue;
                }

                offset += startCodeLen;
                if (offset >= data.length) break;

                // Read NAL unit header (2 bytes for HEVC)
                const nalHeader = (data[offset] << 8) | data[offset + 1];
                const nalType = (nalHeader >> 9) & 0x3F;

                // HEVC NAL unit types: 39 (PREFIX_SEI), 40 (SUFFIX_SEI)
                // Also check for VCL NAL units to track frame numbers
                if (nalType >= 0 && nalType <= 31) {
                    // VCL NAL unit (coded slice)
                    frameNumber++;
                } else if (nalType === 39 || nalType === 40) {
                    // SEI NAL unit found
                    offset += 2; // Skip NAL header

                    // Find next start code to determine NAL unit length
                    let nalEnd = offset;
                    while (nalEnd < data.length - 3) {
                        if (data[nalEnd] === 0x00 && data[nalEnd + 1] === 0x00 &&
                            (data[nalEnd + 2] === 0x01 || (data[nalEnd + 2] === 0x00 && data[nalEnd + 3] === 0x01))) {
                            break;
                        }
                        nalEnd++;
                    }

                    const seiPayload = data.slice(offset, nalEnd);
                    this.parseSEIPayload(seiPayload, frameNumber, seiData);
                    offset = nalEnd;
                    continue;
                }

                offset++;
            } else {
                offset++;
            }
        }

        return seiData;
    }

    parseSEIPayload(payload, frameNumber, seiData) {
        let offset = 0;

        while (offset < payload.length) {
            // Read payload type (can be multi-byte)
            let payloadType = 0;
            while (offset < payload.length && payload[offset] === 0xFF) {
                payloadType += 255;
                offset++;
            }
            if (offset >= payload.length) break;
            payloadType += payload[offset++];

            // Read payload size (can be multi-byte)
            let payloadSize = 0;
            while (offset < payload.length && payload[offset] === 0xFF) {
                payloadSize += 255;
                offset++;
            }
            if (offset >= payload.length) break;
            payloadSize += payload[offset++];

            if (offset + payloadSize > payload.length) break;

            const payloadData = payload.slice(offset, offset + payloadSize);

            // Parse specific SEI types
            if (payloadType === 136 || payloadType === 0x88) {
                // Time code SEI
                const timecode = this.parseTimecodeSEI(payloadData);
                if (timecode) {
                    seiData.push({
                        frameNumber,
                        type: payloadType,
                        ...timecode
                    });
                }
            } else if (payloadType === 5 || payloadType === 0x05) {
                // User data unregistered SEI
                const userData = this.parseUserDataSEI(payloadData);
                if (userData) {
                    seiData.push({
                        frameNumber,
                        type: payloadType,
                        ...userData
                    });
                }
            }

            offset += payloadSize;

            // Skip trailing bits (0x80 byte alignment)
            if (offset < payload.length && payload[offset] === 0x80) {
                offset++;
            }
        }
    }

    parseTimecodeSEI(data) {
        try {
            if (data.length < 5) return null;

            // Create a bit reader
            let bitOffset = 0;
            const readBits = (numBits) => {
                let result = 0;
                for (let i = 0; i < numBits; i++) {
                    const byteIndex = Math.floor(bitOffset / 8);
                    const bitIndex = 7 - (bitOffset % 8);
                    if (byteIndex >= data.length) return 0;
                    const bit = (data[byteIndex] >> bitIndex) & 1;
                    result = (result << 1) | bit;
                    bitOffset++;
                }
                return result;
            };

            // Read according to the minimal H265 format
            // Skip a few header bits according to minimal H265 timecode layout
            readBits(2);
            readBits(1);
            readBits(1);
            readBits(5);
            readBits(1);
            readBits(1);
            readBits(1);

            // The actual timecode values
            const frames = readBits(9);   // frames_counter, size=9
            const seconds = readBits(6);  // seconds_counter, size=6
            const minutes = readBits(6);  // minutes_counter, size=6
            const hours = readBits(5);    // hours_counter, size=5
            readBits(5); // skip reserved bits

            // Build timecode string HH:MM:SS:FF
            const timecodeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;

            return {
                timecodeString,
                hours,
                minutes,
                seconds,
                frames,
                dropFrame: false
            };
        } catch (e) {
            return null;
        }
    }

    parseUserDataSEI(data) {
        try {
            // Skip UUID (16 bytes) if present
            let offset = 0;
            if (data.length > 16) {
                offset = 16;
            }

            // Try to decode remaining as UTF-8 string (often JSON)
            const textData = data.slice(offset);
            let jsonPayload = new TextDecoder('utf-8').decode(textData);
            jsonPayload = jsonPayload.replace(/[^\x20-\x7E]/g, '');
            jsonPayload = jsonPayload.trim();

            return {
                jsonPayload
            };
        } catch (e) {
            return null;
        }
    }
}
