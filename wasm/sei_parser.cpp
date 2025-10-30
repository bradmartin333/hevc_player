#include "sei_parser.hpp"
#include <sstream>
#include <iomanip>
#include <cstring>

SEIParser::SEIParser() : sequentialFrameCounter(0) {}

SEIParser::~SEIParser() {}

std::vector<SEIEntry> SEIParser::parse(const uint8_t* data, size_t dataSize) {
    std::vector<SEIEntry> entries;
    sequentialFrameCounter = 0;

    // Find all NAL units in the bitstream
    auto nalUnits = findNALUnits(data, dataSize);

    for (const auto& nal : nalUnits) {
        size_t offset = nal.first;
        size_t size = nal.second;

        if (size < 2) continue; // Need at least NAL header

        const uint8_t* nalData = data + offset;

        // Parse NAL header (HEVC uses 2-byte header)
        uint8_t nalUnitType = (nalData[0] >> 1) & 0x3F;

        // Check if this is an SEI NAL unit
        if (nalUnitType == HEVC_NAL_SEI_PREFIX || nalUnitType == HEVC_NAL_SEI_SUFFIX) {
            parseSEINAL(nalData, size, entries);
        }
    }

    return entries;
}

std::vector<std::pair<size_t, size_t>> SEIParser::findNALUnits(const uint8_t* data, size_t dataSize) {
    std::vector<std::pair<size_t, size_t>> nalUnits;

    size_t i = 0;
    while (i < dataSize - 3) {
        // Look for start codes: 0x00 00 01 or 0x00 00 00 01
        if (data[i] == 0x00 && data[i + 1] == 0x00) {
            size_t startCodeLen = 0;

            if (data[i + 2] == 0x01) {
                startCodeLen = 3;
            } else if (data[i + 2] == 0x00 && i + 3 < dataSize && data[i + 3] == 0x01) {
                startCodeLen = 4;
            }

            if (startCodeLen > 0) {
                size_t nalStart = i + startCodeLen;

                // Find next start code
                size_t j = nalStart + 1;
                size_t nalEnd = dataSize;

                while (j < dataSize - 3) {
                    if (data[j] == 0x00 && data[j + 1] == 0x00 &&
                        (data[j + 2] == 0x01 || (data[j + 2] == 0x00 && j + 3 < dataSize && data[j + 3] == 0x01))) {
                        nalEnd = j;
                        break;
                    }
                    j++;
                }

                nalUnits.push_back({nalStart, nalEnd - nalStart});
                i = nalEnd;
            } else {
                i++;
            }
        } else {
            i++;
        }
    }

    return nalUnits;
}

void SEIParser::parseSEINAL(const uint8_t* nalData, size_t nalSize, std::vector<SEIEntry>& entries) {
    if (nalSize < 3) return; // Need NAL header + at least 1 byte

    // Skip 2-byte NAL header
    const uint8_t* seiData = nalData + 2;
    size_t seiSize = nalSize - 2;

    size_t pos = 0;
    while (pos < seiSize) {
        // Read payload type
        uint32_t payloadType = 0;
        while (pos < seiSize && seiData[pos] == 0xFF) {
            payloadType += 255;
            pos++;
        }
        if (pos >= seiSize) break;
        payloadType += seiData[pos++];

        // Read payload size
        uint32_t payloadSize = 0;
        while (pos < seiSize && seiData[pos] == 0xFF) {
            payloadSize += 255;
            pos++;
        }
        if (pos >= seiSize) break;
        payloadSize += seiData[pos++];

        // Extract payload
        if (pos + payloadSize > seiSize) break;

        const uint8_t* payload = seiData + pos;

        // Decode RBSP
        std::vector<uint8_t> decodedPayload = rbspDecode(payload, payloadSize);

        // Parse based on type
        if (payloadType == SEI_TYPE_USER_DATA_UNREGISTERED) {
            if (decodedPayload.size() >= 16) { // Must have UUID
                uint32_t frameNum = frameNumberFromUUID(decodedPayload.data());
                SEIEntry entry = parseUserDataUnregistered(decodedPayload.data(), decodedPayload.size(), frameNum);
                entries.push_back(entry);
            }
        } else if (payloadType == SEI_TYPE_TIME_CODE) {
            SEIEntry entry = parseTimecode(decodedPayload.data(), decodedPayload.size(), sequentialFrameCounter);
            entries.push_back(entry);
            sequentialFrameCounter++;
        }

        pos += payloadSize;

        // Skip trailing bits (RBSP stop bit and alignment)
        if (pos < seiSize && seiData[pos] == 0x80) {
            pos++;
        }
    }
}

std::vector<uint8_t> SEIParser::rbspDecode(const uint8_t* data, size_t size) {
    std::vector<uint8_t> decoded;
    decoded.reserve(size);

    for (size_t i = 0; i < size; ) {
        if (i + 2 < size && data[i] == 0x00 && data[i + 1] == 0x00 && data[i + 2] == 0x03) {
            // Emulation prevention: 0x00 00 03 -> 0x00 00
            decoded.push_back(data[i++]);
            decoded.push_back(data[i++]);
            i++; // Skip 0x03
        } else {
            decoded.push_back(data[i++]);
        }
    }

    return decoded;
}

SEIEntry SEIParser::parseUserDataUnregistered(const uint8_t* payload, size_t payloadSize, uint32_t frameNumber) {
    SEIEntry entry;
    entry.type = SEI_TYPE_USER_DATA_UNREGISTERED;
    entry.frameNumber = frameNumber;

    // First 16 bytes are UUID
    if (payloadSize < 16) {
        entry.jsonPayload = "{}";
        return entry;
    }

    // Remaining bytes are user data (should be JSON)
    size_t jsonSize = payloadSize - 16;
    if (jsonSize > 0) {
        const uint8_t* jsonData = payload + 16;
        entry.jsonPayload = std::string(reinterpret_cast<const char*>(jsonData), jsonSize);
    } else {
        entry.jsonPayload = "{}";
    }

    entry.payload.assign(payload, payload + payloadSize);
    entry.rawBytes = bytesToHex(payload, payloadSize);

    return entry;
}

SEIEntry SEIParser::parseTimecode(const uint8_t* payload, size_t payloadSize, uint32_t frameNumber) {
    SEIEntry entry;
    entry.type = SEI_TYPE_TIME_CODE;
    entry.frameNumber = frameNumber;
    entry.payload.assign(payload, payload + payloadSize);
    entry.rawBytes = bytesToHex(payload, payloadSize);

    if (payloadSize == 0) {
        entry.timecodeString = "--:--:--:--";
        return entry;
    }

    // Parse timecode bits
    BitReader reader(payload, payloadSize);

    try {
        // Based on H.265 D.2.27 Time code SEI message
        uint32_t num_clock_ts = reader.readBits(2);
        uint32_t units_field_based_flag = reader.readBits(1);
        uint32_t counting_type = reader.readBits(5);
        uint32_t full_timestamp_flag = reader.readBits(1);
        uint32_t discontinuity_flag = reader.readBits(1);
        uint32_t cnt_dropped_flag = reader.readBits(1);
        uint32_t n_frames = reader.readBits(9);
        
        uint32_t seconds = 0;
        uint32_t minutes = 0;
        uint32_t hours = 0;

        if (full_timestamp_flag) {
            seconds = reader.readBits(6);
            minutes = reader.readBits(6);
            hours = reader.readBits(5);
        } else {
            // Partial timestamp parsing would go here
            // For simplicity, we'll leave at 0
        }

        // Build timecode string HH:MM:SS:FF
        std::stringstream ss;
        ss << std::setfill('0') << std::setw(2) << hours << ":"
           << std::setfill('0') << std::setw(2) << minutes << ":"
           << std::setfill('0') << std::setw(2) << seconds << ":"
           << std::setfill('0') << std::setw(2) << n_frames;
        
        entry.timecodeString = ss.str();
    } catch (...) {
        entry.timecodeString = "--:--:--:--";
    }

    return entry;
}

uint32_t SEIParser::frameNumberFromUUID(const uint8_t* uuid) {
    // UUID is constructed with frame number in first 4 bytes (big-endian)
    return (uuid[0] << 24) | (uuid[1] << 16) | (uuid[2] << 8) | uuid[3];
}

std::string SEIParser::bytesToHex(const uint8_t* data, size_t size) {
    std::stringstream ss;
    ss << std::hex << std::setfill('0');
    for (size_t i = 0; i < size && i < 32; i++) { // Limit to first 32 bytes
        ss << std::setw(2) << static_cast<int>(data[i]) << " ";
    }
    if (size > 32) {
        ss << "...";
    }
    return ss.str();
}

// BitReader implementation
SEIParser::BitReader::BitReader(const uint8_t* data, size_t size)
    : data(data), size(size), bytePos(0), bitPos(0) {}

uint32_t SEIParser::BitReader::readBits(int numBits) {
    uint32_t value = 0;
    
    for (int i = 0; i < numBits; i++) {
        if (bytePos >= size) {
            return value; // End of data
        }

        // Read bit from current position
        int bit = (data[bytePos] >> (7 - bitPos)) & 1;
        value = (value << 1) | bit;

        bitPos++;
        if (bitPos >= 8) {
            bitPos = 0;
            bytePos++;
        }
    }

    return value;
}

bool SEIParser::BitReader::hasMoreBits() const {
    return bytePos < size;
}
