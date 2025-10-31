# HEVC Player

HEVC container (.mov) video player with real-time SEI metadata extraction and display

## TODO

- Figure out why mp4box does not provide .mov metadata
  - Use .mov metadata for FPS and duration calculations
- Better responsive layout and styling
- Add zoom and pan controls for video playback
  - Show zoomed area in a separate window?
  - Show selected section in video overlay as a rectangle?
- Implement a cool JSON viewer for frame SEI data
- Optimize WASM SEI parsing for performance
- Better loading indicators and user feedback during file processing
  - Possibly batch WASM operations so the page doesn't freeze

## Features

- **SEI Metadata Extraction (via WASM)**
  - Unregistered User Data (0x05): Frame-synchronized display
  - Timecode (0x88): Human-readable format (HH:MM:SS:FF)
- **Export Functionality**: Download all extracted SEI metadata as JSON
- **Keyboard Shortcuts**: 
  - `Space` or `K`: Play/Pause
  - `Arrow Left` or `J`: Previous frame
  - `Arrow Right` or `L`: Next frame
- **Video Playback**: Native .mov file support with HEVC codec
- **Frame-by-frame Navigation**: Step through frames to inspect metadata
- **Real-time Overlay**: Optional metadata overlay during playback

## Development Setup

### Install Node.js 20+ and npm

1. Install nvm with `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash`
1. Install the latest version of node with `nvm install node`

### Install Emscripten SDK (for WASM compilation)

1. `git clone https://github.com/emscripten-core/emsdk.git`
1.  `cd emsdk/`
1. `./emsdk install latest`
1. `./emsdk activate latest`

### Run locally

1. `npm install` to install dependencies in the project root directory
1. `npm run dev` to start the development server in the project root directory
