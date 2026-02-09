import * as fs from "fs/promises";
import { BodyReader, HTTPRange, HTTPReq, HTTPRes } from "./types";
import { readerFromMemory, fieldGet } from "./message";
import BufferPool, { BufferTier } from "./BufferPool";
import * as path from "path";

const FILES_DIR = path.resolve("files");
export async function serveStaticFile(
    req: HTTPReq,
    requestedPath: string,
): Promise<HTTPRes> {
    // only allow to access files inside the files folder
    const absolutePath = path.resolve(requestedPath);
    if (!absolutePath.startsWith(FILES_DIR + path.sep)) {
        return resp404();
    }

    let fp: null | fs.FileHandle = null;
    try {
        fp = await fs.open(absolutePath, "r");
        //get its size
        const stat = await fp.stat();
        if (!stat.isFile()) {
            return resp404();
        }
        const size = stat.size;
        const resp = await staticFileResp(req, fp, size);
        fp = null; // transfered to the BodyReader
        return resp;
    } catch (exec) {
        // cannot open file or whatever
        console.info("error saving file:", exec);
        return resp404();
    } finally {
        await fp?.close();
    }
}

function resp404(): HTTPRes {
    return {
        code: 404,
        headers: [Buffer.from("Server: my_first_http_server")],
        body: readerFromMemory(Buffer.from("Not Found")),
    };
}

function resp416(size: number): HTTPRes {
    return {
        code: 416,
        headers: [
            Buffer.from("Server: my_first_http_server"),
            Buffer.from(`Content-Range: bytes */${size}`),
        ],
        body: readerFromMemory(Buffer.from("Range Not Satisfiable")),
    };
}

function readerFromStaticFile(
    fp: fs.FileHandle,
    start: number,
    end: number,
): BodyReader {
    let got = 0; // bytes read so far
    const buf = BufferPool.getInstance().borrow(BufferTier.Big);
    const length = end - start;
    if (!buf) {
        throw new Error("cannot allocate buffer");
    }
    return {
        length,
        read: async (): Promise<Buffer> => {
            const offset = start + got;
            const maxread = Math.min(buf.length, end - offset); // may be 0
            const r: fs.FileReadResult<Buffer> = await fp.read({
                buffer: buf,
                position: offset,
                length: maxread,
            });
            got += r.bytesRead;
            if (got > length || (got < length && r.bytesRead === 0)) {
                // file size changed.
                // cannot continue since we have sent the 'Content-Length'.
                throw new Error("file size change, abandon it!");
            }
            return r.buffer.subarray(0, r.bytesRead);
        },
        close: async () => {
            await fp.close();
            BufferPool.getInstance().return(buf);
        },
    };
}

function parseBytesRanges(r: null | Buffer, size: number): HTTPRange[] {
    if (r === null) {
        //send full file
        return [[0, null]];
    }

    // check for invalid patterns
    const str = r.toString().trim();
    if (!str.startsWith("bytes=")) {
        return [[0, null]];
    }

    const rangeSpec = str.slice(6);

    // Regex to parse:
    // Group 1: Start (optional)
    // Group 2: End (optional)
    // strictly matching "digits-digits", "-digits", or "digits-"
    const match = rangeSpec.match(/^(\d*)-(\d*)$/);
    if (!match) {
        return [[0, null]];
    }

    const startStr = match[1];
    const endStr = match[2];

    // Case A: Suffix Range (e.g., "-10")
    // Matches regex where Group 1 is empty, Group 2 has digits
    if (startStr === "" && endStr !== "") {
        const suffixLength = parseInt(endStr, 10);

        // Table Row: "-0" -> "invalid"
        if (suffixLength === 0) {
            return [[0, null]];
        }

        // Table Row: "-60" (size 50) -> "[0, 50)"
        return [suffixLength];
    }

    // Case B: Integer Range (e.g., "0-10", "10-")
    // Group 1 must have digits
    if (startStr !== "") {
        const start = parseInt(startStr, 10);

        // Table Row: "60-" (size 50) -> "out of range"
        // If start is beyond the file size, it's unsatisfiable
        if (start >= size) {
            throw Error("out of range");
        }

        // Sub-case: Open-ended (e.g., "10-")
        if (endStr === "") {
            // Table Row: "10-" (size 50) -> "[10, 50)" [cite: 31]
            return [[start, size]];
        }

        // Sub-case: Closed range (e.g., "0-10", "4-3")
        const endRaw = parseInt(endStr, 10);

        // Table Row: "4-3" -> "invalid"
        // If start > end, the range is logically invalid.
        if (start > endRaw) {
            return [[0, null]];
        }

        // Table Row: "0-60" (size 50) -> "[0, 50)"
        // The end is inclusive in spec, but we use exclusive for slice/read.
        // We clamp the end to the size.
        const end = Math.min(endRaw + 1, size);

        return [[start, end]];
    }

    return [[0, null]];
}

async function staticFileResp(
    req: HTTPReq,
    fp: fs.FileHandle,
    size: number,
): Promise<HTTPRes> {
    const rangeHeader = fieldGet(req.headers, "Range");
    let range;
    try {
        range = parseBytesRanges(rangeHeader, size)[0]; //only one range is supported
    } catch {
        return resp416(size);
    }
    let start, end;
    if (typeof range === "number") {
        start = size - range;
        end = size;
    } else {
        const [rangeStart, rangeEnd] = range;
        start = rangeStart;

        if (rangeEnd === null) {
            end = size;
        } else {
            end = rangeEnd;
        }
    }
    // validation
    start = Math.max(start, 0);
    end = Math.min(end, size);

    const reader: BodyReader = readerFromStaticFile(fp, start, end);
    if (start === 0 && end === size) {
        return { code: 200, headers: [], body: reader };
    } else {
        return {
            code: 206,
            headers: [
                Buffer.from(`Content-Range: bytes ${start}-${end - 1}/${size}`),
                Buffer.from(`Content-Length: ${end - start}`),
            ],
            body: reader,
        };
    }
}
