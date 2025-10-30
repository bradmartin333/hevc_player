#pragma once

#include <vector>
#include <cstdint>
#include <string>

// SEI NAL Unit Types for HEVC
#define HEVC_NAL_SEI_PREFIX 39
#define HEVC_NAL_SEI_SUFFIX 40

// SEI Payload Types
#define SEI_TYPE_USER_DATA_UNREGISTERED 5
#define SEI_TYPE_TIME_CODE 136

struct SEIEntry {
    uint8_t type;           // SEI payload type (5 or 136)
    uint32_t frameNumber;   // Derived from UUID or sequential
    std::vector<uint8_t> payload;  // Raw payload bytes
    std::string jsonPayload;       // Parsed JSON (for type 5)
    std::string timecodeString;    // Formatted timecode (for type 136)
    std::string rawBytes;          // Hex representation of raw bytes
};

class SEIParser {
public:
    SEIParser();
    ~SEIParser();

    // Parse SEI data from HEVC bitstream
    std::vector<SEIEntry> parse(const uint8_t* data, size_t dataSize);

private:
    // Find NAL units in the bitstream
    std::vector<std::pair<size_t, size_t>> findNALUnits(const uint8_t* data, size_t dataSize);

    // Parse a single SEI NAL unit
    void parseSEINAL(const uint8_t* nalData, size_t nalSize, std::vector<SEIEntry>& entries);

    // RBSP decoding (reverse of RbspEncode)
    std::vector<uint8_t> rbspDecode(const uint8_t* data, size_t size);

    // Parse user data unregistered (0x05)
    SEIEntry parseUserDataUnregistered(const uint8_t* payload, size_t payloadSize, uint32_t frameNumber);

    // Parse timecode (0x88)
    SEIEntry parseTimecode(const uint8_t* payload, size_t payloadSize, uint32_t frameNumber);

    // Extract frame number from UUID
    uint32_t frameNumberFromUUID(const uint8_t* uuid);

    // Convert bytes to hex string
    std::string bytesToHex(const uint8_t* data, size_t size);

    // Bit reader helper for timecode parsing
    class BitReader {
    public:
        BitReader(const uint8_t* data, size_t size);
        uint32_t readBits(int numBits);
        bool hasMoreBits() const;

    private:
        const uint8_t* data;
        size_t size;
        size_t bytePos;
        int bitPos;
    };

    uint32_t sequentialFrameCounter;
};
