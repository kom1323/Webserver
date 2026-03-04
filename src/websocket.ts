import { createQueue, Queue } from "./blockingQueue";
import { BodyReader, WSMsg, WSServer } from "./types";

const WS_DATA_TEXT = 0x01;
const WS_DATA_BINARY = 0x02;
const WS_CONTROL_CLOSE = 0x08;
const WS_CONTROL_PING = 0x09;
const WS_CONTROL_PONG = 0x0a;
const WS_QUEUE_CAPACITY = 10;
function createWSServer(reqBody: BodyReader): [WSServer, BodyReader] {
    // WS API
    const qrecv: Queue<WSMsg> = createQueue<WSMsg>(WS_QUEUE_CAPACITY);
    const qsend: Queue<WSMsg> = createQueue<WSMsg>(WS_QUEUE_CAPACITY);
    const ws: WSServer = {
        send: qsend.pushBack, // throws if closed
        recv: qrecv.popFront, // returns null if closed
        close: (): void => {
            qsend.close(); // generates a WS_CTRL_CLOSE
            qrecv.close();
        },
    };

    const qsock: Queue<Buffer> = createQueue<Buffer>(WS_QUEUE_CAPACITY);
    // task 1: reading form the socket
    wsServerRecv(reqBody, qrecv, qsock, ws)
        .finally(ws.close)
        .catch(console.error);
    // task 2: writing to the socket
    wsServerSend(qsend, qsock)
        .finally(ws.close)
        .finally(qsock.close)
        .catch(console.error);
    const resBody: BodyReader = {
        length: -1,
        read: async () => (await qsock.popFront()) || Buffer.from(""),
    };
    return [ws, resBody];
}

async function wsServerSend(
    qsend: Queue<WSMsg>,
    qsock: Queue<Buffer>,
): Promise<void> {
    while (true) {
        const msg = await qsend.popFront();
        if (!msg) {
            // graceful "Close" frame
            const closeFrame = Buffer.from([0x88, 0x00]);
            await qsock.pushBack(closeFrame);
            break;
        }
        const data = await msg.read();
        const len = data.length;
        let header: Buffer;

        // determine header size based on length
        if (len <= 125) {
            header = Buffer.alloc(2);
            header[1] = len;
        } else if (len <= 65535) {
            header = Buffer.alloc(4);
            header[1] = 126;
            header.writeUInt16BE(len, 2); // write 16-bit length
        } else {
            header = Buffer.alloc(10);
            header[1] = 127;
            header.writeBigUInt64BE(BigInt(len), 2); // write 64-bit length
        }

        // set FIN bit and Opcode (T)
        header[0] = 0x80 | msg.type;

        const frame = Buffer.concat([header, data]);
        await qsock.pushBack(frame);
    }
}

async function wsServerRecv(
    reqBody: BodyReader,
    qrecv: Queue<WSMsg>,
    qsock: Queue<Buffer>,
    ws: WSServer,
): Promise<void> {
    let data: null | Queue<Buffer> = null;

    try {
        // loop for each frame
        while (true) {
            const body = await reqBody.read();
            if (body.length === 0) break;

            const opcode = body[0] & 0x0f;
            const isFin = body[0] & 0x80;
            const isMasked = body[1] & 0x80;
            if (!isMasked) return;
            let msg: WSMsg;
            if (opcode === WS_DATA_TEXT || opcode === WS_DATA_BINARY) {
                const q = (data = createQueue<Buffer>(10));

                msg = {
                    type: opcode,
                    length: reqBody.length,
                    read: async () => (await q.popFront()) || Buffer.from(""),
                };

                await qrecv.pushBack(msg);
            }
            const payloadLen = body[1] & 0x7f;
            let len: number | bigint;
            let curr = 2; // already looked at byte 0 & 1
            if (payloadLen < 126) {
                len = payloadLen;
            } else if (payloadLen === 126) {
                len = body.readUint16BE(curr);
                curr += 2;
            } else {
                len = body.readBigUint64BE(curr);
                curr += 8;
            }

            const maskKey = body.subarray(curr, curr + 4);
            curr += 4;
            const payload = body.subarray(curr, curr + Number(len)); // Node.js Buffer max size fits into type number

            for (let i = 0; i < payload.length; i++) {
                payload[i] = payload[i] ^ maskKey[i % 4];
            }

            if (opcode === WS_CONTROL_CLOSE) {
                await qsock.pushBack(Buffer.from([0x88, 0x00])); // echo close
                // socket is closed by caller
                return;
            }
            if (opcode === WS_CONTROL_PING) {
                const header = Buffer.from([0x8a, payload.length]);
                await qsock.pushBack(Buffer.concat([header, payload]));
                continue;
            }
            if (opcode === WS_CONTROL_PONG) {
                continue;
            }
            if (data) data.pushBack(payload);

            if (isFin) {
                data?.close();
                data = null;
            }
        }
    } finally {
        // close the message data in case the app is blocking on it
        data?.close();
    }
}
