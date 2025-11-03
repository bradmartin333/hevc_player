// NAL Converter - Converts MP4 length-prefixed NAL units to Annex-B format

export class NALConverter {
    convertToAnnexB(view, nalLenSize) {
        try {
            const chunks = [];
            let off = 0;
            if (typeof nalLenSize !== 'number' || nalLenSize < 1 || nalLenSize > 4) nalLenSize = 4;

            while (off + nalLenSize <= view.length) {
                let nalLen = 0;
                for (let i = 0; i < nalLenSize; i++) {
                    nalLen = (nalLen << 8) | view[off + i];
                }

                if (nalLen <= 0 || nalLen > view.length - off - nalLenSize) {
                    return view; // Already Annex-B or malformed
                }

                chunks.push(new Uint8Array([0x00, 0x00, 0x00, 0x01]));
                chunks.push(view.slice(off + nalLenSize, off + nalLenSize + nalLen));
                off += nalLenSize + nalLen;
            }

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
    }
}
