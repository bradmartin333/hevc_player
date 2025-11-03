// HEVC Player - Main JavaScript Logic

import { SEIParser } from './parsers/seiParser.js';
import { MP4Demuxer } from './demux/mp4Demuxer.js';
import { VideoControls } from './controls/videoControls.js';
import { formatTime, formatFileSize } from './utils/formatters.js';

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
        this.seiData = new Map();
        this.currentSEIFrame = null;

        // Initialize parsers and controllers
        this.seiParser = new SEIParser();
        this.mp4Demuxer = new MP4Demuxer();
        this.videoControls = new VideoControls(this.video, this);

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
        this.frameBackwardBtn.addEventListener('click', () => this.videoControls.stepFrameBackward(60));
        this.frameForwardBtn.addEventListener('click', () => this.videoControls.stepFrameForward(60));
        this.seekBar.addEventListener('input', (e) => this.videoControls.handleSeek(e.target.value));
        this.overlayToggle.addEventListener('change', (e) => this.toggleOverlay(e));
        this.exportBtn.addEventListener('click', () => this.exportSEIData());
        this.video.addEventListener('loadedmetadata', () => this.handleVideoLoaded());
        this.video.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.video.addEventListener('play', () => this.videoControls.updatePlayButton(true));
        this.video.addEventListener('pause', () => this.videoControls.updatePlayButton(false));
        this.video.addEventListener('ended', () => this.videoControls.updatePlayButton(false));
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
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
                this.videoControls.stepFrameBackward(60);
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.videoControls.stepFrameForward(60);
                break;
            case 'k':
                event.preventDefault();
                this.videoControls.togglePlayPause();
                break;
            case 'j':
                event.preventDefault();
                this.videoControls.stepFrameBackward(60);
                break;
            case 'l':
                event.preventDefault();
                this.videoControls.stepFrameForward(60);
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
                // Raw Annex-B / .h265 file
                this.updateStatus('Parsing raw HEVC stream...');
                parsingStarted = true;
                this.setSEILoading(true);
                const ab = await file.arrayBuffer();
                const u8 = new Uint8Array(ab);
                try {
                    const seiDataRaw = this.seiParser.parseSEIFromAnnexB(u8);
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
    }

    handleTimeUpdate() {
        const currentTime = this.video.currentTime;
        this.currentTimeDisplay.textContent = formatTime(currentTime);
        this.seekBar.value = currentTime;
        this.updateSEIMetadata(currentTime);
    }

    updateSEIMetadata(currentTime) {
        if (!this.video.duration) return;

        const fps = 60; // TODO get from .mov metadata
        const frameNumber = Math.floor(currentTime * fps);

        this.updateUserDataDisplay(frameNumber);

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

            try {
                const oldScrollEl = currentDataDiv.querySelector('.json-raw') || currentDataDiv;
                const prevScrollTop = oldScrollEl ? oldScrollEl.scrollTop : 0;
                const prevScrollHeight = oldScrollEl ? oldScrollEl.scrollHeight : 0;

                let pretty = userData.jsonPayload || '';
                try {
                    const obj = typeof pretty === 'string' ? JSON.parse(pretty) : pretty;
                    pretty = JSON.stringify(obj, null, 2);
                } catch (e) {
                    // Leave as raw string
                }

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
                let pretty = userData.jsonPayload || '';
                try {
                    const obj = typeof pretty === 'string' ? JSON.parse(pretty) : pretty;
                    pretty = JSON.stringify(obj, null, 2);
                } catch (err) { }
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
