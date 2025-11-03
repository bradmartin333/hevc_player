// MP4 Demuxer - Handles MP4/MOV file demuxing using MP4Box.js

import { NALConverter } from '../utils/nalConverter.js';

export class MP4Demuxer {
    constructor() {
        this.nalConverter = new NALConverter();
    }

    async demuxContainerToNal(file) {
        return new Promise(async (resolve) => {
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
                    // Find HEVC/hvc1/hev1 track
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

                    // Detect NAL unit length size
                    const detectedNalLen = this.detectNalUnitLength(info, hevcTrackId);
                    mp4boxFile._detectedNalUnitLength = detectedNalLen;
                    console.log('Detected NAL unit length (bytes):', detectedNalLen);

                    mp4boxFile.setExtractionOptions(hevcTrackId, null, { nbSamples: 0 });
                    mp4boxFile.start();
                };

                mp4boxFile.onSamples = (id, user, samples) => {
                    const detectedNalLen = mp4boxFile._detectedNalUnitLength || 4;
                    for (const s of samples) {
                        const u8 = new Uint8Array(s.data);
                        const converted = this.nalConverter.convertToAnnexB(u8, detectedNalLen);
                        samplesData.push(converted);
                    }
                };

                mp4boxFile.appendBuffer(arrayBuffer);

                // Parse metadata
                let metadata = null;
                const udtaBox = mp4boxFile.getBox('udta');
                if (udtaBox) {
                    const keys = Object.values(udtaBox.meta.keys.keys);
                    const list = Object.values(udtaBox.meta.ilst.list);
                    if (keys.length === list.length) {
                        metadata = {};
                        for (let i = 0; i < keys.length; i++) {
                            metadata[keys[i].toString().replace('mdta', '')] = list[i].value;
                        }
                    }
                }

                mp4boxFile.flush();

                // Wait for onSamples to complete
                setTimeout(() => {
                    if (samplesData.length === 0) {
                        return resolve({ nalData: null, metadata });
                    }

                    // Concatenate all samples
                    let total = 0;
                    for (const s of samplesData) total += s.length;
                    const out = new Uint8Array(total);
                    let offset = 0;
                    for (const s of samplesData) {
                        out.set(s, offset);
                        offset += s.length;
                    }

                    resolve({ nalData: out, metadata });
                }, 50);
            } catch (err) {
                console.error('Demux error', err);
                resolve({ nalData: null, metadata: null });
            }
        });
    }

    detectNalUnitLength(info, hevcTrackId) {
        try {
            const trackInfo = info.tracks.find(tt => tt.id === hevcTrackId);
            if (!trackInfo) return 4;

            let detectedNalLen = 4;

            if (trackInfo.hvcC && typeof trackInfo.hvcC.lengthSizeMinusOne === 'number') {
                detectedNalLen = trackInfo.hvcC.lengthSizeMinusOne + 1;
            } else if (trackInfo.avcC && typeof trackInfo.avcC.lengthSizeMinusOne === 'number') {
                detectedNalLen = trackInfo.avcC.lengthSizeMinusOne + 1;
            } else if (trackInfo.sample_description?.[0]) {
                const sd = trackInfo.sample_description[0];
                if (sd.hvcC && typeof sd.hvcC.lengthSizeMinusOne === 'number') {
                    detectedNalLen = sd.hvcC.lengthSizeMinusOne + 1;
                } else if (sd.avcC && typeof sd.avcC.lengthSizeMinusOne === 'number') {
                    detectedNalLen = sd.avcC.lengthSizeMinusOne + 1;
                }
            }

            // Clamp to valid range
            if (detectedNalLen < 1 || detectedNalLen > 4) {
                detectedNalLen = 4;
            }

            return detectedNalLen;
        } catch (e) {
            console.warn('Failed to detect nal unit length, falling back to 4 bytes', e);
            return 4;
        }
    }

    isContainerFile(uint8Array, name = '') {
        try {
            const lower = name.toLowerCase();
            if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.m4v')) return true;

            if (uint8Array.length >= 12) {
                const asAscii = String.fromCharCode.apply(null, Array.from(uint8Array.slice(4, 8)));
                if (asAscii === 'ftyp') return true;
            }
        } catch (e) {
            // ignore
        }
        return false;
    }
}
