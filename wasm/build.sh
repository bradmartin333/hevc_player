#!/bin/bash

# Build script for SEI Parser WASM module

echo "Building SEI Parser WASM module..."

# Check if emcc is available
if ! command -v emcc &> /dev/null
then
    echo "Error: Emscripten compiler (emcc) not found!"
    echo "Please install Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

# Create output directory
mkdir -p build

# Compile WASM module
emcc \
    sei_parser.cpp \
    bindings.cpp \
    -o build/sei_parser.js \
    -I . \
    -std=c++17 \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME="SEIParser" \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
    -s ENVIRONMENT='web' \
    -O3 \
    --bind

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Output files:"
    echo "  - build/sei_parser.js"
    echo "  - build/sei_parser.wasm"
    
    # Copy to root for easier access
    cp build/sei_parser.js ../sei_parser.js
    cp build/sei_parser.wasm ../sei_parser.wasm
    
    echo ""
    echo "Files copied to root directory. Ready to use!"
else
    echo "Build failed!"
    exit 1
fi
