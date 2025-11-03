// Video Controls - Handles video playback, seeking, and frame stepping

export class VideoControls {
    constructor(video, ui) {
        this.video = video;
        this.ui = ui;
    }

    togglePlayPause() {
        if (this.video.paused) {
            const playPromise = this.video.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.error('Play failed:', err);
                    if (err.name === 'NotSupportedError') {
                        this.ui.updateStatus('Playback not supported for this file in your browser. Try .mov/.mp4 with HEVC support or use Safari/Edge.');
                    } else {
                        this.ui.updateStatus('Playback failed: ' + err.message);
                    }
                });
            }
        } else {
            this.video.pause();
        }
    }

    updatePlayButton(isPlaying) {
        this.ui.playPauseBtn.innerHTML = isPlaying ? `<i class="fa-solid fa-pause"></i>` : `<i class="fa-solid fa-play"></i>`;
    }

    handleSeek(value) {
        this.video.currentTime = value;
    }

    stepFrameBackward(fps = 60) {
        if (!this.video.duration) return;
        const currentFrame = Math.round(this.video.currentTime * fps);
        const targetFrame = Math.max(currentFrame - 1, 0);
        const newTime = Math.max(targetFrame / fps + 0.001, 0);
        this.video.currentTime = newTime;
        if (!this.video.paused) {
            this.video.pause();
        }
    }

    stepFrameForward(fps = 60) {
        if (!this.video.duration) return;
        const currentFrame = Math.round(this.video.currentTime * fps);
        const maxFrame = Math.floor(this.video.duration * fps);
        const targetFrame = Math.min(currentFrame + 1, maxFrame);
        let newTime = targetFrame / fps + 0.001;
        if (newTime > this.video.duration) newTime = this.video.duration;
        this.video.currentTime = newTime;
        if (!this.video.paused) {
            this.video.pause();
        }
    }
}
