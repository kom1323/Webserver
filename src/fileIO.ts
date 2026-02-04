import * as fs from "fs/promises";
import { BodyReader, HTTPRes } from "./types";
import { readerFromMemory } from "./message";
import BufferPool, { BufferTier } from "./BufferPool";
import * as path from "path";

const FILES_DIR = path.resolve("files");
export async function serveStaticFile(requestedPath: string): Promise<HTTPRes> {
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
        const reader: BodyReader = readerFromStaticFile(fp, size);
        return { code: 200, headers: [], body: reader };
    } catch (exec) {
        // cannot open file or whatever
        console.info("error saving file:", exec);
        return resp404();
    } finally {
        fp = null; // transfered to the BodyReader
    }
}

function resp404(): HTTPRes {
    return {
        code: 404,
        headers: [Buffer.from("Server: my_first_http_server")],
        body: readerFromMemory(Buffer.from("Not Found")),
    };
}

function readerFromStaticFile(fp: fs.FileHandle, size: number): BodyReader {
    let got = 0; // bytes read so far
    const buf = BufferPool.getInstance().borrow(BufferTier.Big);
    return {
        length: size,
        read: async (): Promise<Buffer> => {
            const r: fs.FileReadResult<Buffer> = await fp.read({ buffer: buf });
            got += r.bytesRead;
            if (got > size || (got < size && r.bytesRead === 0)) {
                // file size changed.
                // cannot continue since we have sent the 'Content-Length'.
                throw new Error("file size change, abandon it!");
            }
            // NOTE: the automatically allocated buffer may be larger
            return r.buffer.subarray(0, r.bytesRead);
        },
        close: async () => await fp.close(),
    };
}
