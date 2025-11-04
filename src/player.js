// HEVC Player - Main JavaScript Logic

import { SEIParser } from './parsers/seiParser.js';
import { MP4Demuxer } from './demux/mp4Demuxer.js';
import { VideoControls } from './controls/videoControls.js';
import { ZoomPanController } from './controls/zoomPanController.js';
import { formatTime, formatFileSize, formatJSON } from './utils/formatters.js';

// Track expanded JSON paths globally
window.expandedJSONPaths = new Set();

// Global function for toggling JSON sections
window.toggleJSON = function (id) {
    const content = document.getElementById(id);
    const button = content?.previousElementSibling;
    if (content && button) {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? '' : 'none';
        button.textContent = isHidden ? '-' : '+';
        
        // Track the path for this toggle
        const path = content.getAttribute('data-json-path');
        if (path) {
            if (isHidden) {
                window.expandedJSONPaths.add(path);
            } else {
                window.expandedJSONPaths.delete(path);
            }
        }
    }
};

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
        this.zoomPanBtn = document.getElementById('zoomPanBtn');
        this.currentFile = null;
        this.seiData = new Map();
        this.currentSEIFrame = null;
        this.activeFPS = 60; // Default FPS
        this.metadataView = 'container'; // 'container' or 'frame'
        this.metadata = null; // Container metadata

        // Initialize parsers and controllers
        this.seiParser = new SEIParser();
        this.mp4Demuxer = new MP4Demuxer();
        this.videoControls = new VideoControls(this.video, this);
        this.zoomPanController = new ZoomPanController(this.video, this);

        this.initEventListeners();
        this.updateStatus('Ready - Load a video file to begin');

        // Keep metadata-panel height matching the video-wrapper height
        this.videoWrapperEl = document.querySelector('.video-wrapper');
        this.metadataPanelEl = document.querySelector('.metadata-panel');
        this.syncMetadataToVideoWrapper();
        window.addEventListener('resize', () => this.syncMetadataToVideoWrapper());
        try {
            const ro = new ResizeObserver(() => this.syncMetadataToVideoWrapper());
            if (this.videoWrapperEl) ro.observe(this.videoWrapperEl);
        } catch (e) {
            // ResizeObserver may not be available
        }
    }

    initEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.playPauseBtn.addEventListener('click', () => this.videoControls.togglePlayPause());
        this.frameBackwardBtn.addEventListener('click', () => this.videoControls.stepFrameBackward(this.activeFPS));
        this.frameForwardBtn.addEventListener('click', () => this.videoControls.stepFrameForward(this.activeFPS));
        this.seekBar.addEventListener('input', (e) => this.videoControls.handleSeek(e.target.value));
        this.overlayToggle.addEventListener('change', (e) => this.toggleOverlay(e));
        this.exportBtn.addEventListener('click', () => this.exportSEIData());
        this.zoomPanBtn.addEventListener('click', () => this.zoomPanController.openZoomPanWindow());
        this.video.addEventListener('loadedmetadata', () => this.handleVideoLoaded());
        this.video.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.video.addEventListener('play', () => this.videoControls.updatePlayButton(true));
        this.video.addEventListener('pause', () => this.videoControls.updatePlayButton(false));
        this.video.addEventListener('ended', () => this.videoControls.updatePlayButton(false));
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));

        // Metadata view toggle
        document.querySelectorAll('input[name="metadataView"]').forEach(radio => {
            radio.addEventListener('change', (e) => this.handleMetadataViewChange(e.target.value));
        });
    }

    handleKeyPress(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        switch (event.key) {
            case ' ':
                event.preventDefault();
                this.videoControls.togglePlayPause();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                this.videoControls.stepFrameBackward(this.activeFPS);
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.videoControls.stepFrameForward(this.activeFPS);
                break;
            case 'k':
                event.preventDefault();
                this.videoControls.togglePlayPause();
                break;
            case 'j':
                event.preventDefault();
                this.videoControls.stepFrameBackward(this.activeFPS);
                break;
            case 'l':
                event.preventDefault();
                this.videoControls.stepFrameForward(this.activeFPS);
                break;
        }
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        let parsingStarted = false;

        const lower = file.name.toLowerCase();
        if (!lower.endsWith('.mov')) {
            this.updateStatus('Only .mov files are supported in this player. Please select a .mov file.');
            return;
        }

        this.currentFile = file;
        this.fileName.textContent = file.name + ' (' + formatFileSize(file.size) + ')';

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

            const headerBuf = await file.slice(0, 64).arrayBuffer();
            const headerU8 = new Uint8Array(headerBuf);

            if (this.mp4Demuxer.isContainerFile(headerU8, file.name)) {
                this.updateStatus('Demuxing container and extracting NAL units...');
                parsingStarted = true;
                this.setSEILoading(true);

                const { nalData, metadata } = await this.mp4Demuxer.demuxContainerToNal(file);
                this.metadata = metadata;
                this.activeFPS = metadata['project_frame_rate'] || 60;
                if (this.activeFPS > 1000) this.activeFPS /= 1000;

                // Display container metadata immediately if in container view
                if (this.metadataView === 'container') {
                    this.displayContainerMetadata();
                }

                if (!nalData) {
                    this.updateStatus('No HEVC samples found or demux failed');
                    if (parsingStarted) { this.setSEILoading(false); parsingStarted = false; }
                    return;
                }

                this.updateStatus('Parsing SEI data from container...');
                try {
                    const seiDataRaw = this.seiParser.parseSEIFromAnnexB(nalData);
                    if (seiDataRaw && seiDataRaw.length > 0) {
                        this.processSEIData(seiDataRaw);
                        if (this.status) this.status.style.display = 'none';
                    } else {
                        this.seiData.clear();
                        this.updateStatus('Ready - No SEI data found in file');
                    }
                } catch (e) {
                    console.error('SEI parsing failed', e);
                    this.updateStatus('Error parsing SEI data: ' + (e && e.message ? e.message : String(e)));
                }
            } else {
                // Currently, only container files are supported
                this.updateStatus('Unsupported file format. Only .mov files with HEVC video are supported.');
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

    processSEIData(seiDataRaw) {
        console.log('processSEIData called with', seiDataRaw.length, 'entries');
        this.seiData.clear();
        seiDataRaw.forEach((entry) => {
            const frameNumber = entry.frameNumber || 0;
            if (!this.seiData.has(frameNumber)) {
                this.seiData.set(frameNumber, {});
            }

            const frameData = this.seiData.get(frameNumber);

            if (entry.type === 0x88 || entry.type === 136) {
                frameData.timecode = entry;
            } else if (entry.type === 0x05 || entry.type === 5) {
                frameData.userData = entry;
            }
        });

        console.log(`Processed SEI data: ${this.seiData.size} frames`);

        if (this.exportBtn && this.seiData.size > 0) {
            this.exportBtn.style.display = 'inline-flex';
        }

        this.video.currentTime = 0;
    }

    handleVideoLoaded() {
        const duration = this.video.duration;
        this.durationDisplay.textContent = formatTime(duration);
        this.seekBar.max = duration;
        this.updateStatus('Loading SEI data');

        // Show zoom/pan button when video is loaded and has valid dimensions
        if (this.video.videoWidth > 0 && this.video.videoHeight > 0 && this.zoomPanBtn) {
            this.zoomPanBtn.style.display = '';
        }
    }

    handleTimeUpdate() {
        const currentTime = this.video.currentTime;
        this.currentTimeDisplay.textContent = formatTime(currentTime);
        this.seekBar.value = currentTime;
        this.updateSEIMetadata(currentTime);
    }

    updateSEIMetadata(currentTime) {
        if (!this.video.duration) return;

        const frameNumber = Math.floor(currentTime * this.activeFPS);
        this.updateUserDataDisplay(frameNumber);

        if (this.overlayToggle.checked) {
            this.updateOverlay(frameNumber);
        }
    }

    handleMetadataViewChange(view) {
        this.metadataView = view;
        if (view === 'container') {
            this.displayContainerMetadata();
        } else {
            const frameNumber = Math.floor(this.video.currentTime * this.activeFPS);
            this.updateUserDataDisplay(frameNumber);
        }
    }

    displayContainerMetadata() {
        const currentDataDiv = document.getElementById('currentData');

        if (!this.metadata) {
            currentDataDiv.innerHTML = '<p class="no-data">No container metadata available</p>';
            return;
        }

        const formatted = formatJSON(this.metadata);
        currentDataDiv.innerHTML = `
            <div class="data-item">
                <div class="json-raw"><pre class="mono">${formatted}</pre></div>
            </div>
        `;
    }

    updateUserDataDisplay(frameNumber) {
        // Only update if we're in frame view mode
        if (this.metadataView !== 'frame') {
            return;
        }

        const seiFrame = this.seiData.get(frameNumber);
        const currentDataDiv = document.getElementById('currentData');

        if (seiFrame && seiFrame.userData) {
            this.currentSEIFrame = frameNumber;
            const userData = seiFrame.userData;

            try {
                const oldScrollEl = currentDataDiv.querySelector('.json-raw') || currentDataDiv;
                const prevScrollTop = oldScrollEl ? oldScrollEl.scrollTop : 0;
                const prevScrollHeight = oldScrollEl ? oldScrollEl.scrollHeight : 0;

                const pretty = formatJSON(userData.jsonPayload);
                currentDataDiv.innerHTML = `
                    <div class="data-item">
                        <div class="json-raw"><pre class="mono">${pretty}</pre></div>
                    </div>
                `;

                const newScrollEl = currentDataDiv.querySelector('.json-raw') || currentDataDiv;
                if (newScrollEl) {
                    if (prevScrollHeight > 0) {
                        const ratio = prevScrollTop / prevScrollHeight;
                        newScrollEl.scrollTop = Math.round(ratio * newScrollEl.scrollHeight);
                    } else {
                        newScrollEl.scrollTop = prevScrollTop;
                    }
                }
            } catch (e) {
                const pretty = formatJSON(userData.jsonPayload);
                currentDataDiv.innerHTML = `
                    <div class="data-item">
                        <div class="json-raw"><pre class="mono">${pretty}</pre></div>
                    </div>
                `;
            }
        } else {
            this.currentSEIFrame = null;
            currentDataDiv.innerHTML = '<p class="no-data">No SEI data available for this frame</p>';
        }
    }

    syncMetadataToVideoWrapper() {
        try {
            if (!this.videoWrapperEl || !this.metadataPanelEl) return;
            const h = this.videoWrapperEl.clientHeight;
            this.metadataPanelEl.style.height = h + 'px';
        } catch (e) {
            // Non-fatal
        }
    }

    updateOverlay(frameNumber) {
        const seiFrame = this.seiData.get(frameNumber);

        if (seiFrame && (seiFrame.timecode || seiFrame.userData)) {
            let overlayContent = '';
            let addNewline = false;
            if (seiFrame.timecode) {
                overlayContent += `TC: ${seiFrame.timecode.timecodeString}`;
                addNewline = true;
            }
            if (this.metadata && this.metadata['reel_name']) {
                if (addNewline) overlayContent += '\n';
                overlayContent += `Reel: ${this.metadata['reel_name']}`;
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

    updateStatus(message) {
        if (!this.status) return;
        this.status.style.display = '';
        this.status.textContent = message;
    }

    setSEILoading(isLoading) {
        try {
            const panels = [this.fileMetadata, this.timecodeMetadata, this.userDataMetadata];
            panels.forEach(p => {
                if (!p) return;
                const panelEl = p.closest ? p.closest('.metadata-panel') : (p.parentElement || p);
                if (!panelEl) return;
                if (isLoading) panelEl.classList.add('sei-loading');
                else panelEl.classList.remove('sei-loading');
            });

            if (this.status) {
                if (isLoading) this.status.classList.add('loading');
                else this.status.classList.remove('loading');
            }
        } catch (e) {
            console.warn('setSEILoading failed', e);
        }
    }

    exportSEIData() {
        if (this.seiData.size === 0) {
            alert('No SEI data to export');
            return;
        }

        const exportData = {
            filename: this.currentFile ? this.currentFile.name : 'unknown',
            exportTimestamp: new Date().toISOString(),
            clipMetadata: this.metadata,
            frameMetadata: {}
        };

        this.seiData.forEach((data, frameNumber) => {
            if (data.userData) {
                let userData;
                try {
                    userData = typeof data.userData.jsonPayload === 'string'
                        ? JSON.parse(data.userData.jsonPayload)
                        : data.userData.jsonPayload;
                } catch (e) {
                    // If JSON parsing fails, store as raw string
                    userData = data.userData.jsonPayload;
                }

                exportData.frameMetadata[frameNumber] = {
                    timecode: data.timecode.timecodeString || null,
                    userData: userData || null
                };
            }
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
document.addEventListener('DOMContentLoaded', () => {
    /**
     * Checks if the user agent indicates a mobile or tablet device.
     * @returns {boolean} - True if the device is mobile, false otherwise.
     */
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Alert users on mobile devices about potential issues
    if (isMobile) {
        alert("This website is designed for desktop use and may not work correctly on your device.");
    }

    // Expose to window for debugging/inspection
    window.player = new HEVCPlayer();
});
