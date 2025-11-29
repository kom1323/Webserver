export type DynBuf = {
  data: Buffer;
  pos: number;
  length: number;
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
  console.log("len: ", len);
  console.log("buf.data.length: ", buf.data.length);
  console.log("buf.pos: ", buf.pos);
  console.log("buff.data: ", buf.data.toString());
  if (buf.pos > buf.data.length / 2) {
    buf.data.copyWithin(0, buf.pos + len, buf.length);
    buf.length -= buf.pos + len;
    buf.pos = 0;
  } else {
    buf.pos += len;
  }
}

export function cutMessage(buf: DynBuf): null | Buffer {
  const idx = buf.data.subarray(buf.pos, buf.length).indexOf("\n");
  if (idx < 0) {
    return null;
  }

  const msg = Buffer.from(buf.data.subarray(buf.pos, buf.pos + idx + 1));
  bufPop(buf, idx + 1);
  return msg;
}
