#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "sei_parser.hpp"

using namespace emscripten;

// Convert SEIEntry to JavaScript object
val seiEntryToJS(const SEIEntry& entry) {
    val obj = val::object();
    obj.set("type", entry.type);
    obj.set("frameNumber", entry.frameNumber);
    obj.set("jsonPayload", entry.jsonPayload);
    obj.set("timecodeString", entry.timecodeString);
    obj.set("rawBytes", entry.rawBytes);
    return obj;
}

// Main parsing function exposed to JavaScript
val parseSEIData(const val& jsArray) {
    // Convert JavaScript Uint8Array to C++ vector
    unsigned int length = jsArray["length"].as<unsigned int>();
    std::vector<uint8_t> data(length);
    
    // Copy data from JavaScript array to C++ vector
    for (unsigned int i = 0; i < length; i++) {
        data[i] = jsArray[i].as<uint8_t>();
    }

    // Parse SEI data
    SEIParser parser;
    std::vector<SEIEntry> entries = parser.parse(data.data(), data.size());

    // Convert results to JavaScript array
    val result = val::array();
    for (size_t i = 0; i < entries.size(); i++) {
        result.set(i, seiEntryToJS(entries[i]));
    }

    return result;
}

EMSCRIPTEN_BINDINGS(sei_parser_module) {
    function("parseSEIData", &parseSEIData);
}
