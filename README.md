# HEVC Player

HEVC container (.mov) video player with real-time SEI metadata extraction and display

## TODO

- Use .mov metadata for FPS and duration calculations (Currently logged to console)
- Add zoom and pan controls for video playback (Separate window with rectangle overlay on player)

## Features

- **SEI Metadata Extraction**
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

### Run locally

1. `npm install` to install dependencies in the project root directory
1. `npm run dev` to start the development server in the project root directory

## Module Interaction Flow

```
User Loads File
    ↓
player.js (HEVCPlayer)
    ↓
    ├─→ mp4Demuxer.demuxContainerToNal()
    │       ├─→ nalConverter.convertToAnnexB()
    │       └─→ metadataParser.parseMetadata()
    ↓
    ├─→ seiParser.parseSEIFromAnnexB()
    │       ├─→ parseTimecodeSEI()
    │       └─→ parseUserDataSEI()
    ↓
    └─→ Display Results
            ├─→ formatTime()
            ├─→ formatFileSize()
            └─→ videoControls (user interaction)
```
