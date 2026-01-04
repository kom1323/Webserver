import { DynBuf } from "./types";
import type { TCPConn } from "./types";
import { soWrite } from "./message";
import BufferPool from "./BufferPool";

export type BufferedWriter = {
  write: (data: Buffer) => Promise<void>;
  flush: () => Promise<void>;
};

export function bufPush(buf: DynBuf, data: Buffer): void {
  const newLen = buf.length + data.length;
  if (buf.data.length < newLen) {
    let cap = Math.max(buf.data.length, 32);
    while (cap < newLen) {
      cap *= 2;
    }
    const grown = Buffer.alloc(cap);
    buf.data.copy(grown, 0, 0);
    buf.data = grown;
  }
  data.copy(buf.data, buf.length, 0);
  buf.length = newLen;
}

export function bufPop(buf: DynBuf, len: number): void {
  if (buf.pos >= buf.data.length / 2) {
    buf.data.copyWithin(0, buf.pos + len, buf.length);
    buf.length -= buf.pos + len;
    buf.pos = 0;
  } else {
    buf.pos += len;
  }
}

export function createBufferedWriter(
  conn: TCPConn,
  respBuff: Buffer
): BufferedWriter {
  let offset = 0;
  const bufferSize = BufferPool.getInstance().getBufferSize();

  return {
    write: async function (data: Buffer): Promise<void> {
      console.assert(data.length > 0);
      if (data.length > bufferSize - offset) {
        await this.flush();
      }
      if (data.length > bufferSize) {
        return soWrite(conn, data);
      }
      const bytesCopied = data.copy(respBuff, offset);
      offset += bytesCopied;
    },
    flush: async (): Promise<void> => {
      if (offset === 0) return;
      const dataToSend = respBuff.subarray(0, offset);
      offset = 0;
      return soWrite(conn, dataToSend);
    },
  };
}
