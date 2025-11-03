// Zoom/Pan Controller - Manages popup window with zoom/pan functionality

export class ZoomPanController {
    constructor(video, player) {
        this.video = video;
        this.player = player;
        this.popupWindow = null;
        this.canvas = null;
        this.ctx = null;
        this.animationFrameId = null;
        this.closeCheckInterval = null;

        // Zoom/Pan state
        this.zoom = 2.0; // 2x zoom by default
        this.panX = 0.5; // Center X (0-1, normalized coordinates)
        this.panY = 0.5; // Center Y (0-1, normalized coordinates)
        this.showOverlayRect = true;

        // Dragging state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragStartPanX = 0;
        this.dragStartPanY = 0;

        // Actual source coordinates (for accurate overlay positioning)
        this.actualSrcX = 0;
        this.actualSrcY = 0;
        this.actualSrcWidth = 0;
        this.actualSrcHeight = 0;
    }

    checkBrowserSupport() {
        // Check if browser supports required features
        try {
            // Check if popups are allowed
            const testPopup = window.open('', '', 'width=1,height=1');
            if (!testPopup) {
                return { supported: false, reason: 'Popup windows are blocked. Please allow popups for this site.' };
            }
            testPopup.close();

            // Check canvas support
            const testCanvas = document.createElement('canvas');
            if (!testCanvas.getContext || !testCanvas.getContext('2d')) {
                return { supported: false, reason: 'Canvas is not supported in this browser.' };
            }

            return { supported: true };
        } catch (e) {
            return { supported: false, reason: 'Browser compatibility check failed: ' + e.message };
        }
    }

    openZoomPanWindow() {
        const compatibility = this.checkBrowserSupport();
        if (!compatibility.supported) {
            alert('Zoom/Pan not available: ' + compatibility.reason);
            return;
        }

        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.focus();
            return;
        }

        // Create popup window
        const width = 800;
        const height = 600;
        const left = window.screenX + 100;
        const top = window.screenY + 100;

        // Open with the external HTML file
        const base = import.meta.env.BASE_URL || '/';
        const popupUrl = window.location.origin + base + 'src/controls/zoom-pan.html';
        this.popupWindow = window.open(
            popupUrl,
            'ZoomPanWindow',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
        );

        if (!this.popupWindow) {
            alert('Failed to open zoom/pan window. Please check popup blocker settings.');
            return;
        }

        // Wait for document to be ready
        this.popupWindow.addEventListener('load', () => {
            this.initializePopupElements();
        });

        // Handle popup close - store interval ID for cleanup
        this.closeCheckInterval = setInterval(() => {
            if (this.popupWindow && this.popupWindow.closed) {
                clearInterval(this.closeCheckInterval);
                this.closeZoomPanWindow();
            }
        }, 500);
    }

    initializePopupElements() {
        const doc = this.popupWindow.document;

        this.canvas = doc.getElementById('zoomCanvas');
        this.ctx = this.canvas.getContext('2d');
        const zoomSlider = doc.getElementById('zoomSlider');
        const zoomValue = doc.getElementById('zoomValue');
        const resetBtn = doc.getElementById('resetBtn');
        const overlayRectBtn = doc.getElementById('overlayRectBtn');

        // Set initial canvas size
        this.resizeCanvas();

        // Event listeners
        zoomSlider.addEventListener('input', (e) => {
            this.zoom = parseFloat(e.target.value);
            zoomValue.textContent = this.zoom.toFixed(1) + 'x';
        });

        resetBtn.addEventListener('click', () => {
            this.resetView();
            zoomSlider.value = this.zoom;
            zoomValue.textContent = this.zoom.toFixed(1) + 'x';
        });

        overlayRectBtn.addEventListener('click', () => {
            this.showOverlayRect = !this.showOverlayRect;
            overlayRectBtn.classList.toggle('active', this.showOverlayRect);

            if (this.showOverlayRect) {
                this.drawOverlayRectangle();
            } else {
                this.removeOverlayRectangle();
            }
        });

        // Canvas interaction
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
        this.canvas.addEventListener('mouseleave', () => this.handleMouseUp());
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.helpEl = doc.getElementsByClassName('help-text')[0];

        // Window resize
        this.popupWindow.addEventListener('resize', () => this.resizeCanvas());

        // Start rendering
        this.startRendering();
    }

    resetView() {
        this.zoom = 2.0;
        this.panX = 0.5;
        this.panY = 0.5;
    }

    updateZoomDisplay() {
        if (!this.popupWindow || this.popupWindow.closed) return;

        const doc = this.popupWindow.document;
        const zoomSlider = doc.getElementById('zoomSlider');
        const zoomValue = doc.getElementById('zoomValue');

        if (zoomSlider) zoomSlider.value = this.zoom;
        if (zoomValue) zoomValue.textContent = this.zoom.toFixed(1) + 'x';
    }

    resizeCanvas() {
        if (!this.canvas || !this.popupWindow) return;

        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();

        // Maintain video aspect ratio
        const videoAspect = this.video.videoWidth / this.video.videoHeight || 16 / 9;
        const containerAspect = rect.width / rect.height;

        if (containerAspect > videoAspect) {
            this.canvas.height = rect.height;
            this.canvas.width = rect.height * videoAspect;
        } else {
            this.canvas.width = rect.width;
            this.canvas.height = rect.width / videoAspect;
        }
    }

    handleMouseDown(e) {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartPanX = this.panX;
        this.dragStartPanY = this.panY;
        this.canvas.classList.add('dragging');
        this.hideHelpIfExists();
    }

    handleMouseMove(e) {
        if (!this.isDragging) return;

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;

        // Convert pixel movement to normalized coordinates
        const moveX = -dx / this.canvas.width / this.zoom;
        const moveY = -dy / this.canvas.height / this.zoom;

        this.panX = Math.max(0, Math.min(1, this.dragStartPanX + moveX));
        this.panY = Math.max(0, Math.min(1, this.dragStartPanY + moveY));
    }

    handleMouseUp() {
        this.isDragging = false;
        if (this.canvas) {
            this.canvas.classList.remove('dragging');
        }
    }

    handleWheel(e) {
        e.preventDefault();

        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        this.zoom = Math.max(1, Math.min(10, this.zoom + delta));

        this.updateZoomDisplay();
        this.hideHelpIfExists();
    }

    hideHelpIfExists() {
        if (!this.helpEl) return;
        this.hideHelp();
    }

    hideHelp() {
        try {
            if (!this.helpEl) return;
            const el = this.helpEl;
            el.style.transition = 'opacity 180ms ease, transform 180ms ease';
            el.style.opacity = '0';
            el.style.transform = 'translateX(-50%) translateY(8px)';
            setTimeout(() => { try { el.style.display = 'none'; } catch (e) { } }, 200);
            this.helpEl = null;
        } catch (e) {
            // ignore
        }
    }

    startRendering() {
        if (!this.canvas || !this.ctx) return;

        const render = () => {
            if (!this.popupWindow || this.popupWindow.closed) {
                this.closeZoomPanWindow();
                return;
            }

            this.renderFrame();
            this.drawOverlayRectangle();
            this.animationFrameId = this.popupWindow.requestAnimationFrame(render);
        };

        render();
    }

    renderFrame() {
        if (!this.ctx || !this.canvas || !this.video.videoWidth) return;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Calculate source rectangle (the zoomed region)
        const srcWidth = this.video.videoWidth / this.zoom;
        const srcHeight = this.video.videoHeight / this.zoom;

        // Calculate source position (keeping it within bounds)
        let srcX = (this.video.videoWidth * this.panX) - (srcWidth / 2);
        let srcY = (this.video.videoHeight * this.panY) - (srcHeight / 2);

        // Clamp to video bounds
        srcX = Math.max(0, Math.min(this.video.videoWidth - srcWidth, srcX));
        srcY = Math.max(0, Math.min(this.video.videoHeight - srcHeight, srcY));

        // Store the actual values for overlay calculation
        this.actualSrcX = srcX;
        this.actualSrcY = srcY;
        this.actualSrcWidth = srcWidth;
        this.actualSrcHeight = srcHeight;

        // Draw the zoomed portion
        try {
            this.ctx.drawImage(
                this.video,
                srcX, srcY, srcWidth, srcHeight,
                0, 0, this.canvas.width, this.canvas.height
            );
        } catch (e) {
            // Video might not be ready
        }
    }

    calculateVideoDisplayMetrics() {
        const videoContainer = this.video.parentElement;
        if (!videoContainer) return null;

        const containerRect = videoContainer.getBoundingClientRect();
        const videoAspect = this.video.videoWidth / this.video.videoHeight;
        const containerAspect = containerRect.width / containerRect.height;

        let displayWidth, displayHeight, offsetX, offsetY;

        if (containerAspect > videoAspect) {
            // Container is wider - video is constrained by height
            displayHeight = containerRect.height;
            displayWidth = displayHeight * videoAspect;
            offsetX = (containerRect.width - displayWidth) / 2;
            offsetY = 0;
        } else {
            // Container is taller - video is constrained by width
            displayWidth = containerRect.width;
            displayHeight = displayWidth / videoAspect;
            offsetX = 0;
            offsetY = (containerRect.height - displayHeight) / 2;
        }

        return { displayWidth, displayHeight, offsetX, offsetY };
    }

    drawOverlayRectangle() {
        if (!this.showOverlayRect) return;

        const videoContainer = this.video?.parentElement;
        if (!videoContainer || !this.video.videoWidth || !this.video.videoHeight) return;
        if (!this.actualSrcWidth || !this.actualSrcHeight) return; // Wait for first render

        const metrics = this.calculateVideoDisplayMetrics();
        if (!metrics) return;

        const { displayWidth, displayHeight, offsetX, offsetY } = metrics;

        // Calculate scale factor from video native resolution to display size
        const scaleX = displayWidth / this.video.videoWidth;
        const scaleY = displayHeight / this.video.videoHeight;

        // Map the source coordinates to display coordinates
        const regionX = this.actualSrcX * scaleX;
        const regionY = this.actualSrcY * scaleY;
        const regionWidth = this.actualSrcWidth * scaleX;
        const regionHeight = this.actualSrcHeight * scaleY;

        // Create or update the rectangle overlay
        let rect = videoContainer.querySelector('.zoom-rect');
        if (!rect) {
            rect = document.createElement('div');
            rect.className = 'zoom-rect';
            videoContainer.appendChild(rect);
        }

        Object.assign(rect.style, {
            position: 'absolute',
            left: (offsetX + regionX) + 'px',
            top: (offsetY + regionY) + 'px',
            width: regionWidth + 'px',
            height: regionHeight + 'px',
            border: '2px solid #4a9eff',
            boxShadow: '0 0 10px rgba(74, 158, 255, 0.6), inset 0 0 10px rgba(74, 158, 255, 0.2)',
            pointerEvents: 'none',
            zIndex: '5'
        });
    }

    removeOverlayRectangle() {
        const videoContainer = this.video?.parentElement;
        if (videoContainer) {
            const rect = videoContainer.querySelector('.zoom-rect');
            rect?.remove();
        }
    }

    closeZoomPanWindow() {
        if (this.animationFrameId && this.popupWindow) {
            this.popupWindow.cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.closeCheckInterval) {
            clearInterval(this.closeCheckInterval);
            this.closeCheckInterval = null;
        }

        // Remove overlay rectangle
        this.removeOverlayRectangle();

        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.close();
        }

        this.popupWindow = null;
        this.canvas = null;
        this.ctx = null;
    }

    isWindowOpen() {
        return this.popupWindow && !this.popupWindow.closed;
    }
}
