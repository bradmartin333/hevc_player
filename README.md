# HEVC Player

HEVC container (.mov) video player with real-time SEI metadata extraction and display

## Features

- **SEI Metadata Extraction**
  - Unregistered User Data (0x05): Frame-synchronized display
  - Timecode (0x88): Human-readable format (HH:MM:SS:FF)
- **Container Metadata**: View container-level metadata in console or export
- **Export Functionality**: Download all extracted SEI metadata as JSON
- **Keyboard Shortcuts**: 
  - `Space` or `K`: Play/Pause
  - `Arrow Left` or `J`: Previous frame
  - `Arrow Right` or `L`: Next frame
- **Video Playback**: Native .mov file support with HEVC codec
- **Frame-by-frame Navigation**: Step through frames to inspect metadata
- **Real-time Overlay**: Optional metadata overlay during playback
- **Zoom and Pan**: Open a separate window to zoom and pan the video frame

## Browser Requirements

### HEVC/H.265 Video Playback Support

This player requires browser support for HEVC/H.265 video codec. **SEI metadata extraction works regardless of browser support**, but video playback requires one of the following:

#### Supported Browsers

**macOS/iOS:**
- Safari (all recent versions) - Native HEVC support ✅
- Chrome 136+ - Native HEVC support ✅
- Edge 136+ - Native HEVC support ✅

**Windows:**
- Chrome 136+ - Native HEVC support ✅
- Edge 136+ - Native HEVC support ✅
- Firefox - Not supported ❌

**Linux (Ubuntu, etc.):**
- **Firefox 137+** with system HEVC codecs - Supported ✅
  ```bash
  sudo apt install gstreamer1.0-libde265 gstreamer1.0-plugins-bad
  ```
- **Chrome/Chromium** - Limited support with VAAPI hardware acceleration
  - Official builds do not include HEVC support due to licensing
  - May work with hardware acceleration if GPU supports VAAPI
  - Third-party patched builds available (unofficial)

#### Fallback Options

If your browser doesn't support HEVC playback:
1. **Use a supported browser** (recommended)
2. **Install system codecs** (Linux only, see above)
3. **Download and play locally** with VLC, MPV, or other media players that support HEVC

The application will automatically detect if your browser supports HEVC and display helpful instructions if it doesn't.

## Development Setup

### Install Node.js 20+ and npm

1. Install nvm with `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash`
1. Install the latest version of node with `nvm install node`

### Run locally

1. `npm install` to install dependencies in the project root directory
1. `npm run dev` to start the development server in the project root directory
