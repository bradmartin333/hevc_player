# HEVC Player 🚧 Work in progress 🚧

HEVC container (.mov) video player with real-time SEI metadata extraction and display

SEI Metadata Extraction (via WASM)
  - Unregistered User Data (0x05): Frame-synchronized display
  - Timecode (0x88): Human-readable format (HH:MM:SS:FF)

## TODO

- Figure out why mp4box does not provide .mov metadata
- Implement a cool JSON viewer for frame SEI data
- Optimize WASM SEI parsing for performance
- Add support for additional SEI message types
- Better loading indicators and user feedback during file processing
- Use webpack or similar for module bundling and asset management
