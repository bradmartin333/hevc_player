# HEVC Player

HEVC container (.mov) video player with real-time SEI metadata extraction and display

## Features

- **SEI Metadata Extraction (via WASM)**
  - Unregistered User Data (0x05): Frame-synchronized display
  - Timecode (0x88): Human-readable format (HH:MM:SS:FF)
- **Video Playback**: Native .mov file support with HEVC codec
- **Frame-by-frame Navigation**: Step through frames to inspect metadata
- **Real-time Overlay**: Optional metadata overlay during playback

## Framework

- Node.js 20+ and npm
- Emscripten SDK (for WASM compilation)

## TODO

- Figure out why mp4box does not provide .mov metadata
- Implement a cool JSON viewer for frame SEI data
- Optimize WASM SEI parsing for performance
- Add support for additional SEI message types
- Better loading indicators and user feedback during file processing
