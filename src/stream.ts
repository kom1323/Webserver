import { fieldGet, fieldGetList } from "./message";
import { BodyReader, HTTPReq, HTTPRes } from "./types";
import * as stream from "stream";
import { pipeline } from "stream/promises";
import zlib from "node:zlib";
import { routeConfigs } from "./config";

export function enableCompresion(req: HTTPReq, res: HTTPRes): void {
    const uri = req.uri.toString();
    const config = routeConfigs.find((c) => uri.startsWith(c.prefix));
    if (!config || !config.compress) {
        return;
    }

    // inform proxies that the response is variable
    res.headers.push(Buffer.from("Vary: content-encoding"));
    if (fieldGet(req.headers, "Range")) {
        return; // incompatible
    }

    const codecs: string[] = fieldGetList(req.headers, "Accept-Encoding");
    const gzipEntry = codecs.find((c) => c.startsWith("gzip"));
    if (!gzipEntry) {
        return; // not requested
    }
    if (gzipEntry.includes(";q=")) {
        const weight = parseFloat(gzipEntry.split("=")[1]);
        if (weight === 0) {
            return; // explicitly forbidden by the client
        }
    }

    const isDynamicRoute =
        // transform the response using gzip
        res.headers.push(Buffer.from("Content-Encoding: gzip"));
    res.body = gzipFilter(res.body, config.flush);
}

function gzipFilter(reader: BodyReader, shouldFlush: boolean): BodyReader {
    const gz: stream.Duplex = zlib.createGzip(
        shouldFlush ? { flush: zlib.constants.Z_SYNC_FLUSH } : {},
    );
    const input: stream.Readable = body2stream(reader);
    (async () => {
        try {
            await pipeline(input, gz);
        } catch (err) {
            gz.destroy(err instanceof Error ? err : new Error(String(err)));
        }
    })(); //not awaiting
    const iter: AsyncIterator<Buffer> = gz.iterator();
    return {
        length: -1, // the compressed "Content-Length" is not known
        read: async (): Promise<Buffer> => {
            const r: IteratorResult<Buffer, void> = await iter.next();
            return r.done ? Buffer.from("") : r.value;
        },
        close: reader.close,
    };
}

function body2stream(reader: BodyReader): stream.Readable {
    let self: null | stream.Readable = null;
    self = new stream.Readable({
        read: async () => {
            try {
                const data: Buffer = await reader.read();
                self!.push(data.length > 0 ? data : null);
            } catch (err) {
                self!.destroy(err instanceof Error ? err : new Error("IO"));
            }
        },
    });
    return self;
}
