// HEVC Player - Main JavaScript Logic

class HEVCPlayer {
    constructor() {
        this.video = document.getElementById('videoPlayer');
        this.fileInput = document.getElementById('fileInput');
        this.fileName = document.getElementById('fileName');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.frameBackwardBtn = document.getElementById('frameBackwardBtn');
        this.frameForwardBtn = document.getElementById('frameForwardBtn');
        this.seekBar = document.getElementById('seekBar');
        this.currentTimeDisplay = document.getElementById('currentTime');
        this.durationDisplay = document.getElementById('duration');
        this.overlayToggle = document.getElementById('overlayToggle');
        this.metadataOverlay = document.getElementById('metadataOverlay');
        this.fileMetadata = document.getElementById('fileMetadata');
        this.timecodeMetadata = document.getElementById('timecodeMetadata');
        this.userDataMetadata = document.getElementById('userDataMetadata');
        this.status = document.getElementById('status');
        this.exportBtn = document.getElementById('exportBtn');
        this.currentFile = null;
        this.seiParser = null;
        this.seiData = new Map(); // frameNumber -> SEI data
        this.currentSEIFrame = null;
        this.initEventListeners();
        this.updateStatus('Ready - Load a video file to begin');
    }

    initEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.frameBackwardBtn.addEventListener('click', () => this.stepFrameBackward());
        this.frameForwardBtn.addEventListener('click', () => this.stepFrameForward());
        this.seekBar.addEventListener('input', (e) => this.handleSeek(e));
        this.overlayToggle.addEventListener('change', (e) => this.toggleOverlay(e));
        this.exportBtn.addEventListener('click', () => this.exportSEIData());
        this.video.addEventListener('loadedmetadata', () => this.handleVideoLoaded());
        this.video.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.video.addEventListener('play', () => this.updatePlayButton(true));
        this.video.addEventListener('pause', () => this.updatePlayButton(false));
        this.video.addEventListener('ended', () => this.updatePlayButton(false));
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    }

    handleKeyPress(event) {
        // Ignore if user is typing in an input
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        switch (event.key) {
            case ' ':
                event.preventDefault();
                this.togglePlayPause();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                this.stepFrameBackward();
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.stepFrameForward();
                break;
            case 'k':
                event.preventDefault();
                this.togglePlayPause();
                break;
            case 'j':
                event.preventDefault();
                this.stepFrameBackward();
                break;
            case 'l':
                event.preventDefault();
                this.stepFrameForward();
                break;
        }
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        let parsingStarted = false;

        // Only allow .mov files as requested
        const lower = file.name.toLowerCase();
        if (!lower.endsWith('.mov')) {
            this.updateStatus('Only .mov files are supported in this player. Please select a .mov file.');
            return;
        }

        this.currentFile = file;
        this.fileName.textContent = file.name + ' (' + this.formatFileSize(file.size) + ')';

        // Attach file to video element for playback
        try {
            if (this._objectUrl) {
                try { URL.revokeObjectURL(this._objectUrl); } catch (e) { /* ignore */ }
                this._objectUrl = null;
            }
            this._objectUrl = URL.createObjectURL(file);
            this.video.src = this._objectUrl;
            try { this.video.load(); } catch (e) { /* some browsers auto-load */ }
        } catch (e) {
            console.warn('Could not attach file to video element', e);
        }

        try {
            this.updateStatus('Preparing file...');

            // Read a small header to detect container type
            const headerBuf = await file.slice(0, 64).arrayBuffer();
            const headerU8 = new Uint8Array(headerBuf);
            if (this.isContainerFile(headerU8, file.name)) {
                this.updateStatus('Demuxing container and extracting NAL units...');
                // show SEI loading indicator
                parsingStarted = true;
                this.setSEILoading(true);
                const annexB = await this.demuxContainerToNal(file);
                if (!annexB) {
                    this.updateStatus('No HEVC samples found or demux failed');
                    // stop loading indicator
                    if (parsingStarted) { this.setSEILoading(false); parsingStarted = false; }
                    return;
                }

                if (typeof window.parseSEIData === 'function') {
                    this.updateStatus('Parsing SEI data from container...');
                    try {
                        const seiDataRaw = window.parseSEIData(annexB);
                        if (seiDataRaw && seiDataRaw.length > 0) {
                            this.processSEIData(seiDataRaw);
                            if (this.status) this.status.style.display = 'none';
                        } else {
                            this.seiData.clear();
                            this.updateStatus('Ready - No SEI data found in file');
                        }
                    } catch (e) {
                        console.error('WASM parseSEIData failed', e);
                        this.updateStatus('Error parsing SEI data: ' + (e && e.message ? e.message : String(e)));
                    }
                } else {
                    console.error('parseSEIData not available');
                    this.updateStatus('WASM parser not available in page');
                }
            } else {
                // Treat as raw Annex-B / .h265 file
                this.updateStatus('Parsing raw HEVC stream...');
                parsingStarted = true;
                this.setSEILoading(true);
                const ab = await file.arrayBuffer();
                const u8 = new Uint8Array(ab);
                if (typeof window.parseSEIData === 'function') {
                    try {
                        const seiDataRaw = window.parseSEIData(u8);
                        if (seiDataRaw && seiDataRaw.length > 0) {
                            this.processSEIData(seiDataRaw);
                            if (this.status) this.status.style.display = 'none';
                        } else {
                            this.seiData.clear();
                            this.updateStatus('Ready - No SEI data found in file');
                        }
                    } catch (e) {
                        console.error('WASM parseSEIData failed', e);
                        this.updateStatus('Error parsing SEI data: ' + (e && e.message ? e.message : String(e)));
                    }
                } else {
                    this.updateStatus('WASM parser not available in page');
                }
            }
        } catch (err) {
            console.error('handleFileSelect error', err);
            this.updateStatus('Error preparing file: ' + (err && err.message ? err.message : String(err)));
        } finally {
            if (parsingStarted) {
                this.setSEILoading(false);
                parsingStarted = false;
            }
        }
    }

    // Heuristic: detect MP4/MOV container by 'ftyp' header or extension
    isContainerFile(uint8Array, name = '') {
        try {
            // Check file extension first
            const lower = name.toLowerCase();
            if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.m4v')) return true;

            // Check for 'ftyp' at offset 4
            if (uint8Array.length >= 12) {
                const asAscii = String.fromCharCode.apply(null, Array.from(uint8Array.slice(4, 8)));
                if (asAscii === 'ftyp') return true;
            }
        } catch (e) {
            // ignore
        }
        return false;
    }

    // Use MP4Box.js to demux container and return concatenated NAL bytes (Uint8Array)
    demuxContainerToNal(file) {
        return new Promise(async (resolve, reject) => {
            try {
                const arrayBuffer = await file.arrayBuffer();
                arrayBuffer.fileStart = 0;

                const { createFile } = await import('mp4box');
                const mp4boxFile = createFile();
                let hevcTrackId = null;
                const samplesData = [];

                mp4boxFile.onError = (e) => {
                    console.error('MP4Box error', e);
                };

                mp4boxFile.onReady = (info) => {
                    // find HEVC/hvc1/hev1 track
                    for (const t of info.tracks) {
                        const codec = (t.codec || '').toLowerCase();
                        if (codec.indexOf('hvc') !== -1 || codec.indexOf('hev') !== -1) {
                            hevcTrackId = t.id;
                            break;
                        }
                    }

                    if (hevcTrackId == null) {
                        console.log('No HEVC track found in container');
                        mp4boxFile.flush();
                        return resolve(null);
                    }

                    // Try to detect NAL unit length size from the track's configuration (hvcC/avcC)
                    // Default to 4 bytes if not available.
                    try {
                        const trackInfo = info.tracks.find(tt => tt.id === hevcTrackId) || null;
                        let detectedNalLen = 4;

                        if (trackInfo) {
                            // MP4Box often exposes parsed config as `hvcC` or `avcC` on the track object
                            if (trackInfo.hvcC && typeof trackInfo.hvcC.lengthSizeMinusOne === 'number') {
                                detectedNalLen = trackInfo.hvcC.lengthSizeMinusOne + 1;
                            } else if (trackInfo.avcC && typeof trackInfo.avcC.lengthSizeMinusOne === 'number') {
                                detectedNalLen = trackInfo.avcC.lengthSizeMinusOne + 1;
                            } else if (trackInfo.sample_description && trackInfo.sample_description[0]) {
                                const sd = trackInfo.sample_description[0];
                                if (sd.hvcC && typeof sd.hvcC.lengthSizeMinusOne === 'number') {
                                    detectedNalLen = sd.hvcC.lengthSizeMinusOne + 1;
                                } else if (sd.avcC && typeof sd.avcC.lengthSizeMinusOne === 'number') {
                                    detectedNalLen = sd.avcC.lengthSizeMinusOne + 1;
                                }
                            }
                        }

                        // Safety: clamp to 1..4 (anything else is unusual for MP4 samples)
                        if (typeof detectedNalLen !== 'number' || detectedNalLen < 1 || detectedNalLen > 4) {
                            detectedNalLen = 4;
                        }

                        // store for use in onSamples closure
                        mp4boxFile._detectedNalUnitLength = detectedNalLen;
                        console.log('Detected NAL unit length (bytes):', detectedNalLen);
                    } catch (e) {
                        console.warn('Failed to detect nal unit length from track info, falling back to 4 bytes', e);
                        mp4boxFile._detectedNalUnitLength = 4;
                    }

                    // request extraction for the HEVC track
                    mp4boxFile.setExtractionOptions(hevcTrackId, null, { nbSamples: 0 });
                    mp4boxFile.start();
                };

                mp4boxFile.onSamples = (id, user, samples) => {
                    // samples is an array of sample objects; sample.data is ArrayBuffer
                    for (const s of samples) {
                        const ab = s.data;
                        const u8 = new Uint8Array(ab);

                        // Convert MP4 length-prefixed NAL units to Annex B (start codes)
                        const detectedNalLen = (mp4boxFile._detectedNalUnitLength) ? mp4boxFile._detectedNalUnitLength : 4;

                        const converted = (function convertToAnnexB(view, nalLenSize) {
                            try {
                                const chunks = [];
                                let off = 0;
                                // Validate nalLenSize
                                if (typeof nalLenSize !== 'number' || nalLenSize < 1 || nalLenSize > 4) nalLenSize = 4;

                                while (off + nalLenSize <= view.length) {
                                    // read big-endian length of NAL
                                    let nalLen = 0;
                                    for (let i = 0; i < nalLenSize; i++) {
                                        nalLen = (nalLen << 8) | view[off + i];
                                    }

                                    if (nalLen <= 0 || nalLen > view.length - off - nalLenSize) {
                                        // sample might already be Annex-B or malformed; abort conversion
                                        return view;
                                    }

                                    // push start code
                                    chunks.push(new Uint8Array([0x00, 0x00, 0x00, 0x01]));
                                    // push nal data slice
                                    chunks.push(view.slice(off + nalLenSize, off + nalLenSize + nalLen));
                                    off += nalLenSize + nalLen;
                                }

                                // concat chunks
                                let total = 0;
                                for (const c of chunks) total += c.length;
                                const out = new Uint8Array(total);
                                let pos = 0;
                                for (const c of chunks) {
                                    out.set(c, pos);
                                    pos += c.length;
                                }
                                return out;
                            } catch (e) {
                                return view;
                            }
                        })(u8, detectedNalLen);

                        samplesData.push(converted);
                    }
                };

                // append and flush the whole file
                mp4boxFile.appendBuffer(arrayBuffer);
                mp4boxFile.flush();

                // Wait a tick for onSamples to be called
                setTimeout(() => {
                    if (samplesData.length === 0) {
                        return resolve(null);
                    }

                    // Concatenate all sample arrays
                    let total = 0;
                    for (const s of samplesData) total += s.length;
                    const out = new Uint8Array(total);
                    let offset = 0;
                    for (const s of samplesData) {
                        out.set(s, offset);
                        offset += s.length;
                    }

                    resolve(out);
                }, 50);
            } catch (err) {
                console.error('Demux error', err);
                resolve(null);
            }
        });
    }



    processSEIData(seiDataRaw) {
        // Convert raw SEI data into structured format
        console.log('processSEIData called with', seiDataRaw.length, 'entries');
        this.seiData.clear();
        seiDataRaw.forEach((entry, index) => {
            // console.log(`Entry ${index}:`, entry);
            const frameNumber = entry.frameNumber || 0;
            if (!this.seiData.has(frameNumber)) {
                this.seiData.set(frameNumber, {});
            }

            const frameData = this.seiData.get(frameNumber);

            if (entry.type === 0x88 || entry.type === 136) {
                // Timecode SEI
                // console.log(`  -> Timecode for frame ${frameNumber}`);
                frameData.timecode = entry;
            } else if (entry.type === 0x05 || entry.type === 5) {
                // User data SEI
                // console.log(`  -> User data for frame ${frameNumber}`);
                // keep the JSON payload as-is (no debug extraction)
                frameData.userData = entry;
            }
        });

        console.log(`Processed SEI data: ${this.seiData.size} frames`);

        // Show export button when we have SEI data
        if (this.exportBtn && this.seiData.size > 0) {
            this.exportBtn.style.display = 'inline-flex';
        }

        // Advance to first frame
        this.video.currentTime = 0;
    }

    handleVideoLoaded() {
        const duration = this.video.duration;
        this.durationDisplay.textContent = this.formatTime(duration);
        this.seekBar.max = duration;
        this.updateStatus('Loading SEI data');
    }

    handleTimeUpdate() {
        const currentTime = this.video.currentTime;
        this.currentTimeDisplay.textContent = this.formatTime(currentTime);
        this.seekBar.value = currentTime;

        // Update SEI metadata for current frame
        this.updateSEIMetadata(currentTime);
    }

    updateSEIMetadata(currentTime) {
        if (!this.video.duration) return;

        const fps = 60; // TODO get from .mov metadata
        const frameNumber = Math.floor(currentTime * fps);

        // Update user data display
        this.updateUserDataDisplay(frameNumber);

        // Update overlay if enabled
        if (this.overlayToggle.checked) {
            this.updateOverlay(frameNumber);
        }
    }

    updateUserDataDisplay(frameNumber) {
        const seiFrame = this.seiData.get(frameNumber);
        const currentDataDiv = document.getElementById('currentData');
        if (seiFrame && seiFrame.userData) {
            this.currentSEIFrame = frameNumber;
            const userData = seiFrame.userData;

            let pretty = userData.jsonPayload || '';
            try {
                const obj = typeof pretty === 'string' ? JSON.parse(pretty) : pretty;
                pretty = JSON.stringify(obj, null, 2);
            } catch (e) {
                // leave as raw string
            }

            currentDataDiv.innerHTML = `
                    <div class="data-item">
                        <div class="json-raw"><pre class="mono">${pretty}</pre></div>
                    </div>
                `;
        } else {
            this.currentSEIFrame = null;
            currentDataDiv.innerHTML = '<p class="no-data">No SEI data available for this frame</p>';
        }
    }


    updateOverlay(frameNumber) {
        const seiFrame = this.seiData.get(frameNumber);

        if (seiFrame && (seiFrame.timecode || seiFrame.userData)) {
            let overlayContent = '';
            if (seiFrame.timecode) {
                overlayContent += `TC: ${seiFrame.timecode.timecodeString}\n`;
            }
            this.metadataOverlay.textContent = overlayContent;
            this.metadataOverlay.classList.add('visible');
        } else {
            this.metadataOverlay.classList.remove('visible');
        }
    }

    toggleOverlay(event) {
        if (event.target.checked) {
            this.updateSEIMetadata(this.video.currentTime);
        } else {
            this.metadataOverlay.classList.remove('visible');
        }
    }

    togglePlayPause() {
        if (this.video.paused) {
            const playPromise = this.video.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.error('Play failed:', err);
                    if (err.name === 'NotSupportedError') {
                        this.updateStatus('Playback not supported for this file in your browser. Try .mov/.mp4 with HEVC support or use Safari/Edge.');
                    } else {
                        this.updateStatus('Playback failed: ' + err.message);
                    }
                });
            }
        } else {
            this.video.pause();
        }
    }

    updatePlayButton(isPlaying) {
        if (isPlaying) {
            this.playPauseBtn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 4h4v16H6zM14 4h4v16h-4z"/>
                </svg>
            `;
        } else {
            this.playPauseBtn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
            `;
        }
    }

    handleSeek(event) {
        this.video.currentTime = event.target.value;
    }

    formatTime(seconds) {
        if (!isFinite(seconds)) return '00:00:00';

        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    formatJSON(jsonString, compact = false) {
        try {
            const obj = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
            return compact ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
        } catch (e) {
            return jsonString || 'Invalid JSON';
        }
    }

    updateStatus(message) {
        if (!this.status) return;
        this.status.style.display = '';
        this.status.textContent = message;
    }

    // Toggle a visible SEI-loading state on the metadata panels and status line
    setSEILoading(isLoading) {
        try {
            const panels = [this.fileMetadata, this.timecodeMetadata, this.userDataMetadata];
            panels.forEach(p => {
                if (!p) return;
                // find the surrounding panel container (.metadata-panel)
                const panelEl = p.closest ? p.closest('.metadata-panel') : (p.parentElement || p);
                if (!panelEl) return;
                if (isLoading) panelEl.classList.add('sei-loading'); else panelEl.classList.remove('sei-loading');
            });

            if (this.status) {
                if (isLoading) this.status.classList.add('loading'); else this.status.classList.remove('loading');
            }
        } catch (e) {
            // non-fatal
            console.warn('setSEILoading failed', e);
        }
    }

    stepFrameBackward() {
        if (!this.video.duration) return;
        const fps = 60; // TODO get from .mov metadata
        // Use rounded current frame to avoid off-by-one due to tiny time differences
        const currentFrame = Math.round(this.video.currentTime * fps);
        const targetFrame = Math.max(currentFrame - 1, 0);
        // Add a tiny epsilon so the browser seeks past any keyframe snapping threshold
        const newTime = Math.max(targetFrame / fps + 0.001, 0);
        this.video.currentTime = newTime;
        if (!this.video.paused) {
            this.video.pause();
        }
    }

    stepFrameForward() {
        if (!this.video.duration) return;
        const fps = 60; // TODO get from .mov metadata
        // Use rounded current frame to avoid off-by-one due to tiny time differences
        const currentFrame = Math.round(this.video.currentTime * fps);
        const maxFrame = Math.floor(this.video.duration * fps);
        const targetFrame = Math.min(currentFrame + 1, maxFrame);
        // Add a small epsilon to move past any keyframe snap-to-zero behavior
        let newTime = targetFrame / fps + 0.001;
        if (newTime > this.video.duration) newTime = this.video.duration;
        this.video.currentTime = newTime;
        if (!this.video.paused) {
            this.video.pause();
        }
    }

    exportSEIData() {
        if (this.seiData.size === 0) {
            alert('No SEI data to export');
            return;
        }

        const exportData = {
            filename: this.currentFile ? this.currentFile.name : 'unknown',
            timestamp: new Date().toISOString(),
            frameCount: this.seiData.size,
            frames: {}
        };

        this.seiData.forEach((data, frameNumber) => {
            exportData.frames[frameNumber] = {
                frameNumber,
                timecode: data.timecode ? {
                    timecodeString: data.timecode.timecodeString,
                    hours: data.timecode.hours,
                    minutes: data.timecode.minutes,
                    seconds: data.timecode.seconds,
                    frames: data.timecode.frames
                } : null,
                userData: data.userData ? {
                    type: data.userData.type,
                    jsonPayload: data.userData.jsonPayload
                } : null
            };
        });

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sei-data-${this.currentFile ? this.currentFile.name.replace(/\.[^/.]+$/, '') : 'export'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Initialize player when DOM is loaded
let player;
document.addEventListener('DOMContentLoaded', () => {
    player = new HEVCPlayer();
});
