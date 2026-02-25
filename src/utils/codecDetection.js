// Codec Detection Utility - Detects browser support for HEVC/H.265

export class CodecDetection {
    constructor() {
        this.hevcSupport = null;
    }

    /**
     * Checks if the browser supports HEVC/H.265 playback
     * @returns {boolean} True if HEVC is supported, false otherwise
     */
    async detectHEVCSupport() {
        if (this.hevcSupport !== null) {
            return this.hevcSupport;
        }

        const video = document.createElement('video');
        const codecs = [
            'video/mp4; codecs="hvc1.1.6.L93.B0"',  // HEVC Main Profile
            'video/mp4; codecs="hev1.1.6.L93.B0"',  // HEVC Main Profile (alternative)
            'video/mp4; codecs="hvc1"',             // Generic HEVC
            'video/mp4; codecs="hev1"'              // Generic HEVC (alternative)
        ];

        // Check using canPlayType
        for (const codec of codecs) {
            const support = video.canPlayType(codec);
            if (support === 'probably' || support === 'maybe') {
                console.log(`HEVC support detected via canPlayType: ${codec} = ${support}`);
                this.hevcSupport = true;
                return true;
            }
        }

        // Check using MediaSource API if available
        if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
            for (const codec of codecs) {
                if (MediaSource.isTypeSupported(codec)) {
                    console.log(`HEVC support detected via MediaSource: ${codec}`);
                    this.hevcSupport = true;
                    return true;
                }
            }
        }

        // Check for WebCodecs API support (Chrome 136+, Safari)
        if (typeof VideoDecoder !== 'undefined') {
            try {
                const config = {
                    codec: 'hvc1.1.6.L93.B0',
                    codedWidth: 1920,
                    codedHeight: 1080
                };
                const support = await VideoDecoder.isConfigSupported(config);
                if (support.supported) {
                    console.log('HEVC support detected via WebCodecs API');
                    this.hevcSupport = true;
                    return true;
                }
            } catch (e) {
                // WebCodecs check failed
            }
        }

        console.log('No HEVC support detected');
        this.hevcSupport = false;
        return false;
    }

    /**
     * Gets the browser name and version
     * @returns {object} Browser info {name, version, os}
     */
    getBrowserInfo() {
        const ua = navigator.userAgent;
        let browserName = 'Unknown';
        let browserVersion = 'Unknown';
        let os = 'Unknown';

        // Detect OS
        if (ua.indexOf('Linux') !== -1) {
            os = 'Linux';
        } else if (ua.indexOf('Mac') !== -1) {
            os = 'macOS';
        } else if (ua.indexOf('Windows') !== -1) {
            os = 'Windows';
        }

        // Detect browser
        if (ua.indexOf('Firefox') !== -1) {
            browserName = 'Firefox';
            const match = ua.match(/Firefox\/(\d+)/);
            if (match) browserVersion = match[1];
        } else if (ua.indexOf('Edg') !== -1) {
            browserName = 'Edge';
            const match = ua.match(/Edg\/(\d+)/);
            if (match) browserVersion = match[1];
        } else if (ua.indexOf('Chrome') !== -1) {
            browserName = 'Chrome';
            const match = ua.match(/Chrome\/(\d+)/);
            if (match) browserVersion = match[1];
        } else if (ua.indexOf('Safari') !== -1) {
            browserName = 'Safari';
            const match = ua.match(/Version\/(\d+)/);
            if (match) browserVersion = match[1];
        }

        return { name: browserName, version: browserVersion, os };
    }

    /**
     * Gets a helpful message for users without HEVC support
     * @returns {string} HTML message with instructions
     */
    getHEVCSupportMessage() {
        const browserInfo = this.getBrowserInfo();
        const { name, version, os } = browserInfo;

        let message = '<div class="hevc-support-message">';
        message += '<h3>HEVC/H.265 Playback Not Supported</h3>';
        message += '<p>Your browser does not support HEVC/H.265 video playback, which is required for this .mov file.</p>';
        
        message += '<h4>Solutions:</h4>';
        message += '<ul>';

        if (os === 'Linux') {
            message += '<li><strong>Firefox 137+:</strong> Update to Firefox 137 or newer and install system HEVC codecs:<br/>';
            message += '<code>sudo apt install gstreamer1.0-libde265 gstreamer1.0-plugins-bad</code></li>';
            
            message += '<li><strong>Chrome/Chromium:</strong> Official builds do not support HEVC on Linux due to licensing. ';
            message += 'You can try:<ul>';
            message += '<li>Chrome with hardware acceleration (if your GPU supports VAAPI)</li>';
            message += '<li>Third-party patched Chromium builds (unofficial)</li>';
            message += '</ul></li>';
        } else if (os === 'Windows' || os === 'macOS') {
            if (name === 'Chrome' && parseInt(version) < 136) {
                message += '<li><strong>Update Chrome:</strong> Chrome 136+ supports HEVC natively. Please update your browser.</li>';
            } else if (name === 'Firefox') {
                message += '<li><strong>Use Chrome or Edge:</strong> Firefox does not support HEVC playback. Please use Chrome 136+, Edge, or Safari instead.</li>';
            } else if (name === 'Safari') {
                message += '<li><strong>Safari:</strong> Should support HEVC natively. Please ensure you have the latest version.</li>';
            }
        }

        message += '<li><strong>Local Playback:</strong> Download the .mov file and play it with VLC, MPV, or another media player that supports HEVC.</li>';
        message += '</ul>';

        message += '<p class="note"><strong>Note:</strong> The SEI metadata extraction will still work, but video playback will not be available in this browser.</p>';
        message += '</div>';

        return message;
    }
}
