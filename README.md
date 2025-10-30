# HEVC Player 🚧 Work in progress 🚧

HEVC video player with real-time SEI metadata extraction and display

## Features

- **Video Playback**
  - Support for `.mov` files containing HEVC video tracks

- **SEI Metadata Extraction** (via WASM)
  - **Unregistered User Data (0x05)**
    - Automatic JSON payload parsing
    - Frame-synchronized display
  - **Timecode (0x88)**
    - Human-readable format (HH:MM:SS:FF)
    - Raw payload bytes display

- **Playback Controls**
  - Play/pause
  - Seek bar with frame-accurate scrubbing
  - Time display (current/duration)

- **Minimal Dependencies**
  - Pure HTML/CSS/JavaScript + WASM
  - Works in modern browsers without plugins
  - No server-side processing required
