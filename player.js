// HEVC Player - Main JavaScript Logic

class HEVCPlayer {
    constructor() {
        this.video = document.getElementById('videoPlayer');
        this.fileInput = document.getElementById('fileInput');
        this.fileName = document.getElementById('fileName');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.seekBar = document.getElementById('seekBar');
        this.currentTimeDisplay = document.getElementById('currentTime');
        this.durationDisplay = document.getElementById('duration');
        this.screenshotBtn = document.getElementById('screenshotBtn');
        this.overlayToggle = document.getElementById('overlayToggle');
        this.metadataOverlay = document.getElementById('metadataOverlay');
        this.fileMetadata = document.getElementById('fileMetadata');
        this.timecodeMetadata = document.getElementById('timecodeMetadata');
        this.userDataMetadata = document.getElementById('userDataMetadata');
        this.clearPinsBtn = document.getElementById('clearPinsBtn');
        this.status = document.getElementById('status');
        this.currentFile = null;
        this.seiParser = null;
        this.seiData = new Map(); // frameNumber -> SEI data
        this.pinnedFrames = new Set();
        this.currentSEIFrame = null;
        this.initEventListeners();
        this.updateStatus('Ready - Load a video file to begin');
    }

    initEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.seekBar.addEventListener('input', (e) => this.handleSeek(e));
        this.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
        this.overlayToggle.addEventListener('change', (e) => this.toggleOverlay(e));
        this.clearPinsBtn.addEventListener('click', () => this.clearAllPins());

        this.video.addEventListener('loadedmetadata', () => this.handleVideoLoaded());
        this.video.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.video.addEventListener('play', () => this.updatePlayButton(true));
        this.video.addEventListener('pause', () => this.updatePlayButton(false));
        this.video.addEventListener('ended', () => this.updatePlayButton(false));
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.currentFile = file;
        this.fileName.textContent = file.name;
        this.updateStatus(`Loading ${file.name}...`);

        // Create object URL for video
        const url = URL.createObjectURL(file);
        this.video.src = url;

        // Warn user for raw .h265 files (many browsers won't play raw H.265)
        const lowerName = file.name.toLowerCase();
        if (lowerName.endsWith('.h265') || lowerName.endsWith('.hevc')) {
            this.updateStatus('Loaded raw .h265 file — parsing SEI enabled but browser playback may be unsupported');
        }

        // Display file metadata
        this.displayFileMetadata(file);

        // Parse SEI data if WASM module is loaded
        if (typeof window.parseSEIData === 'function') {
            this.updateStatus('Parsing SEI data...');
            await this.parseSEIData(file);
        } else if (typeof SEIParser !== 'undefined') {
            this.updateStatus('WASM module loading, please wait...');
            // Wait a bit for WASM to initialize
            setTimeout(async () => {
                if (typeof window.parseSEIData === 'function') {
                    this.updateStatus('Parsing SEI data...');
                    await this.parseSEIData(file);
                } else {
                    this.updateStatus('WASM module failed to load - SEI parsing unavailable');
                }
            }, 1000);
        } else {
            this.updateStatus('WASM module not loaded - SEI parsing unavailable');
        }
    }

    displayFileMetadata(file) {
        const metadata = `
            <div class="json-content">
Name: ${file.name}
Size: ${this.formatFileSize(file.size)}
Type: ${file.type || 'Unknown'}
Modified: ${new Date(file.lastModified).toLocaleString()}
            </div>
        `;
        this.fileMetadata.innerHTML = metadata;
    }

    async parseSEIData(file) {
        try {
            // Read file as ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            console.log(`File loaded: ${uint8Array.length} bytes`);
            console.log(`First 32 bytes:`, Array.from(uint8Array.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));
            // If this looks like an MP4/MOV container, demux it first to extract raw HEVC samples
            if (this.isContainerFile(uint8Array, file.name)) {
                this.updateStatus('Detected container file - demuxing HEVC track...');
                console.log('Container detected, running MP4/MOV demux...');
                const rawNal = await this.demuxContainerToNal(file);
                if (!rawNal || rawNal.length === 0) {
                    console.log('Demux produced no NAL data');
                    this.updateStatus('Ready - No HEVC track or no SEI found in container');
                    return;
                }

                if (window.parseSEIData) {
                    this.updateStatus('Extracting SEI data from demuxed HEVC stream...');
                    console.log('Calling parseSEIData on demuxed stream...');
                    const seiDataRaw = window.parseSEIData(rawNal);
                    console.log('parseSEIData returned:', seiDataRaw);
                    console.log('Number of entries:', seiDataRaw ? seiDataRaw.length : 0);
                    if (seiDataRaw && seiDataRaw.length > 0) {
                        console.log('Processing SEI data...');
                        this.processSEIData(seiDataRaw);
                        this.updateStatus(`Ready - Found ${seiDataRaw.length} SEI entries`);
                    } else {
                        console.log('No SEI data found after demux');
                        this.updateStatus('Ready - No SEI data found in file');
                    }
                } else {
                    console.error('parseSEIData function not available');
                    this.updateStatus('WASM function not available');
                }
                return;
            }

            // Initialize WASM parser if available (raw .h265 path)
            if (window.parseSEIData) {
                this.updateStatus('Extracting SEI data from HEVC stream...');
                console.log('Calling parseSEIData...');

                const seiDataRaw = window.parseSEIData(uint8Array);
                console.log('parseSEIData returned:', seiDataRaw);
                console.log('Number of entries:', seiDataRaw ? seiDataRaw.length : 0);

                // Process SEI data
                if (seiDataRaw && seiDataRaw.length > 0) {
                    console.log('Processing SEI data...');
                    this.processSEIData(seiDataRaw);
                    this.updateStatus(`Ready - Found ${seiDataRaw.length} SEI entries`);
                } else {
                    console.log('No SEI data found');
                    this.updateStatus('Ready - No SEI data found in file');
                }
            } else {
                console.error('parseSEIData function not available');
                this.updateStatus('WASM function not available');
            }
        } catch (error) {
            console.error('Error parsing SEI data:', error);
            this.updateStatus('Error parsing SEI data: ' + error.message);
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
            // Ensure MP4Box is available (vendor script must be present under ./vendor/mp4box.all.min.js)
            if (typeof window.MP4Box === 'undefined' && typeof window.mp4box === 'undefined') {
                console.error('MP4Box is not loaded. Expected vendor/mp4box.all.min.js to be present.');
                this.updateStatus('mp4box.js is not loaded. Please ensure vendor/mp4box.all.min.js exists.');
                return resolve(null);
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                arrayBuffer.fileStart = 0;
                // Normalize MP4Box export shape (UMD vs ESM) and locate createFile factory
                let mp4boxLib = window.MP4Box || window.mp4box || null;
                // If the imported/module object wrapped the actual API under default or MP4Box, try those
                if (mp4boxLib && typeof mp4boxLib.createFile !== 'function') {
                    if (mp4boxLib.default && typeof mp4boxLib.default.createFile === 'function') {
                        mp4boxLib = mp4boxLib.default;
                    } else if (mp4boxLib.MP4Box && typeof mp4boxLib.MP4Box.createFile === 'function') {
                        mp4boxLib = mp4boxLib.MP4Box;
                    }
                }

                if (!mp4boxLib || typeof mp4boxLib.createFile !== 'function') {
                    console.error('MP4Box present but does not expose createFile():', window.MP4Box || window.mp4box);
                    this.updateStatus('mp4box.js loaded but API mismatch (createFile missing) — check console');
                    return resolve(null);
                }

                const mp4boxFile = mp4boxLib.createFile();
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
                        const converted = (function convertToAnnexB(view) {
                            try {
                                const chunks = [];
                                let off = 0;
                                while (off + 4 <= view.length) {
                                    const nalLen = (view[off] << 24) | (view[off + 1] << 16) | (view[off + 2] << 8) | (view[off + 3]);
                                    if (nalLen <= 0 || nalLen > view.length - off - 4) {
                                        // Looks like this sample isn't length-prefixed as expected — abort conversion
                                        return view;
                                    }
                                    // push start code
                                    chunks.push(new Uint8Array([0x00, 0x00, 0x00, 0x01]));
                                    // push nal data slice
                                    chunks.push(view.slice(off + 4, off + 4 + nalLen));
                                    off += 4 + nalLen;
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
                        })(u8);

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
            console.log(`Entry ${index}:`, entry);
            const frameNumber = entry.frameNumber || 0;
            if (!this.seiData.has(frameNumber)) {
                this.seiData.set(frameNumber, {});
            }

            const frameData = this.seiData.get(frameNumber);

            if (entry.type === 0x88 || entry.type === 136) {
                // Timecode SEI
                console.log(`  -> Timecode for frame ${frameNumber}`);
                frameData.timecode = entry;
            } else if (entry.type === 0x05 || entry.type === 5) {
                // User data SEI
                console.log(`  -> User data for frame ${frameNumber}`);
                frameData.userData = entry;
            }
        });

        console.log(`Processed SEI data: ${this.seiData.size} frames`);
    }

    handleVideoLoaded() {
        const duration = this.video.duration;
        this.durationDisplay.textContent = this.formatTime(duration);
        this.seekBar.max = duration;
        this.updateStatus('Video loaded successfully');
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

        // Calculate approximate frame number based on time and assumed framerate
        // Note: In production, you'd get actual framerate from video metadata
        const fps = 30; // Default assumption
        const frameNumber = Math.floor(currentTime * fps);

        // Update timecode display
        this.updateTimecodeDisplay(frameNumber);

        // Update user data display
        this.updateUserDataDisplay(frameNumber);

        // Update overlay if enabled
        if (this.overlayToggle.checked) {
            this.updateOverlay(frameNumber);
        }
    }

    updateTimecodeDisplay(frameNumber) {
        const seiFrame = this.seiData.get(frameNumber);

        if (seiFrame && seiFrame.timecode) {
            const tc = seiFrame.timecode;
            const timecodeString = tc.timecodeString || '--:--:--:--';
            const rawBytes = tc.rawBytes || 'N/A';

            this.timecodeMetadata.innerHTML = `
                <div class="timecode-display">
                    <div class="timecode-value">${timecodeString}</div>
                    <div class="timecode-raw">Raw: ${rawBytes}</div>
                </div>
            `;
        } else {
            this.timecodeMetadata.innerHTML = `
                <div class="timecode-display">
                    <div class="timecode-value">--:--:--:--</div>
                    <div class="timecode-raw">Raw: N/A</div>
                </div>
            `;
        }
    }

    updateUserDataDisplay(frameNumber) {
        const seiFrame = this.seiData.get(frameNumber);
        const currentDataDiv = document.getElementById('currentData');

        if (seiFrame && seiFrame.userData) {
            this.currentSEIFrame = frameNumber;
            const userData = seiFrame.userData;
            const isPinned = this.pinnedFrames.has(frameNumber);

            currentDataDiv.innerHTML = `
                <div class="data-item">
                    <div class="data-item-header">
                        <span class="frame-number">Frame ${frameNumber}</span>
                        <button class="pin-btn ${isPinned ? 'pinned' : ''}" 
                                onclick="player.togglePin(${frameNumber})">
                            ${isPinned ? 'Pinned' : 'Pin'}
                        </button>
                    </div>
                    <div class="json-content">${this.formatJSON(userData.jsonPayload)}</div>
                </div>
            `;
        } else {
            this.currentSEIFrame = null;
            currentDataDiv.innerHTML = '<p class="no-data">No SEI data available for this frame</p>';
        }
    }

    togglePin(frameNumber) {
        if (this.pinnedFrames.has(frameNumber)) {
            this.pinnedFrames.delete(frameNumber);
        } else {
            this.pinnedFrames.add(frameNumber);
        }
        this.updatePinnedDisplay();
        this.updateUserDataDisplay(this.currentSEIFrame || frameNumber);
    }

    updatePinnedDisplay() {
        const pinnedDiv = document.getElementById('pinnedData');

        if (this.pinnedFrames.size === 0) {
            pinnedDiv.innerHTML = '';
            return;
        }

        const pinnedHTML = Array.from(this.pinnedFrames)
            .sort((a, b) => a - b)
            .map(frameNumber => {
                const seiFrame = this.seiData.get(frameNumber);
                if (!seiFrame || !seiFrame.userData) return '';

                const userData = seiFrame.userData;
                return `
                    <div class="pinned-item">
                        <div class="data-item-header">
                            <span class="frame-number">Frame ${frameNumber}</span>
                            <button class="unpin-btn" onclick="player.togglePin(${frameNumber})">
                                Unpin
                            </button>
                        </div>
                        <div class="json-content">${this.formatJSON(userData.jsonPayload)}</div>
                    </div>
                `;
            })
            .join('');

        pinnedDiv.innerHTML = pinnedHTML;
    }

    clearAllPins() {
        this.pinnedFrames.clear();
        this.updatePinnedDisplay();
        if (this.currentSEIFrame !== null) {
            this.updateUserDataDisplay(this.currentSEIFrame);
        }
    }

    updateOverlay(frameNumber) {
        const seiFrame = this.seiData.get(frameNumber);

        if (seiFrame && (seiFrame.timecode || seiFrame.userData)) {
            let overlayContent = '';

            if (seiFrame.timecode) {
                overlayContent += `TC: ${seiFrame.timecode.timecodeString}\n`;
            }

            if (seiFrame.userData && seiFrame.userData.jsonPayload) {
                overlayContent += `\n${this.formatJSON(seiFrame.userData.jsonPayload, true)}`;
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

    takeScreenshot() {
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        const ctx = canvas.getContext('2d');

        // Draw video frame
        ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

        // Add metadata overlay if enabled
        if (this.overlayToggle.checked && this.metadataOverlay.textContent) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(10, 10, 400, 200);
            ctx.fillStyle = '#ffffff';
            ctx.font = '14px Courier New';

            const lines = this.metadataOverlay.textContent.split('\n');
            lines.forEach((line, index) => {
                ctx.fillText(line, 20, 30 + (index * 20));
            });
        }

        // Download screenshot
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `screenshot_${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            this.updateStatus('Screenshot saved');
        });
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
        this.status.textContent = message;
    }
}

// Initialize player when DOM is loaded
let player;
document.addEventListener('DOMContentLoaded', () => {
    player = new HEVCPlayer();
});
