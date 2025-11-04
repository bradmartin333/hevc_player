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
                let tmcdTrackId = null;
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
                        } else if (codec.indexOf('tmcd') !== -1) {
                            tmcdTrackId = t.id;
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
                    if (tmcdTrackId !== null) {
                        mp4boxFile.setExtractionOptions(tmcdTrackId, null, { nbSamples: 0 });
                    }
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

                // Parse metadata (udta/meta)
                let metadata = null;
                const udtaBox = mp4boxFile.getBox('udta');
                if (udtaBox && udtaBox.meta && udtaBox.meta.keys && udtaBox.meta.keys.keys && udtaBox.meta.ilst && udtaBox.meta.ilst.list) {
                    const keys = Object.values(udtaBox.meta.keys.keys || {});
                    const list = Object.values(udtaBox.meta.ilst.list || {});
                    if (keys.length === list.length && keys.length > 0) {
                        metadata = {};
                        for (let i = 0; i < keys.length; i++) {
                            try {
                                const rawKey = keys[i];
                                const keyName = rawKey ? rawKey.toString().replace('mdta', '') : String(i);
                                const entry = list[i];
                                metadata[keyName] = entry && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : null;
                            } catch (e) {
                                continue;
                            }
                        }
                    }
                }

                // Extract 'reel_name' from 'stsd' box if available
                let reelName = null;
                reelName = this.extractReelName(mp4boxFile);
                if (reelName) {
                    if (!metadata) metadata = {};
                    metadata['reel_name'] = reelName;
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

    extractReelName(mp4boxFile) {
        try {
            const stsdBoxes = mp4boxFile.getBoxes('stsd');
            if (stsdBoxes) {
                for (const box of stsdBoxes) {
                    if (!box.entries) continue;
                    for (const entry of box.entries) {
                        if (!entry.data || entry.data.byteLength < entry.hdr_size + 12) continue;

                        const view = new DataView(entry.data.buffer, entry.data.byteOffset);
                        let offset = entry.hdr_size;

                        // Check type (0x3C00)
                        if (view.getUint16(offset, false) !== 0x3C00) continue;
                        offset += 2;

                        const totalSize = view.getUint32(offset, false);
                        offset += 4;

                        // Check key ('name')
                        const key = String.fromCharCode(
                            entry.data[offset], entry.data[offset + 1],
                            entry.data[offset + 2], entry.data[offset + 3]
                        );
                        offset += 4;
                        if (key !== 'name') continue;

                        const keySize = view.getUint16(offset, false);
                        offset += 2;

                        // Validate size and type
                        if (totalSize !== keySize + (offset - entry.hdr_size)) continue;
                        if (view.getUint16(offset, false) !== 0) continue;
                        offset += 2;

                        // Extract reel_name
                        if (keySize > 0 && entry.data.byteLength >= offset + keySize) {
                            const value = String.fromCharCode(...entry.data.slice(offset, offset + keySize));
                            return value;
                        }
                    }
                }
            }
        } catch (e) {
            return null;
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
