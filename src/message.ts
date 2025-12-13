import { HTTPError } from "./error";
export type DynBuf = {
  data: Buffer;
  pos: number;
  length: number;
};

export type HTTPReq = {
  method: string;
  uri: Buffer;
  version: string;
  headers: Buffer[];
};

export type HTTPRes = {
  code: number;
  headers: Buffer[];
  body: BodyReader;
};

export type BodyReader = {
  // the "Content-Length", -1 if unknown.
  length: number;
  // read data. returns an empty buffer after EOF.
  read: () => Promise<Buffer>;
};

const kMaxHeaderLen = 1024 * 8;

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
  if (buf.pos > buf.data.length / 2) {
    buf.data.copyWithin(0, buf.pos + len, buf.length);
    buf.length -= buf.pos + len;
    buf.pos = 0;
  } else {
    buf.pos += len;
  }
}

export function cutMessage(buf: DynBuf): null | HTTPReq {
  const idx = buf.data.subarray(buf.pos, buf.length).indexOf("\r\n\r\n");
  if (idx < 0) {
    if (buf.length >= kMaxHeaderLen) {
      throw new HTTPError(413, "header is too large");
    }
    return null;
  }

  const msg = parseHTTPReq(buf.data.subarray(buf.pos, buf.pos + idx + 4));
  bufPop(buf, idx + 4);
  return msg;
}

function parseHTTPReq(data: Buffer): HTTPReq {
  const lines: Buffer[] = splitLines(data);
  const [method, uri, version] = parseRequestLine(lines[0]);
  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const h = Buffer.from(lines[i]);
    if (!validateHeaderName(h)) {
      throw new HTTPError(400, "bad field");
    }
    headers.push(h);
  }
  // the header ends by an empty line
  console.assert(lines[lines.length - 1].length === 0);
  return {
    method,
    uri,
    version,
    headers,
  };
}

function splitLines(data: Buffer): Buffer[] {
  const buf: Buffer[] = [];
  let offset = 0;
  let idx = 0;
  while ((idx = data.indexOf("\r\n", offset)) !== -1) {
    buf.push(data.subarray(offset, idx));
    offset = idx + 2;
  }

  return buf;
}

function parseRequestLine(line: Buffer): [string, Buffer, string] {
  const decoder = new TextDecoder();
  const parsedBuffer: Buffer[] = [];
  let offset = 0;
  let idx = 0;
  while ((idx = line.indexOf(" ", offset)) !== -1) {
    parsedBuffer.push(line.subarray(offset, idx));
    offset = idx + 1;
    if (parsedBuffer.length > 2) {
      throw new HTTPError(400, "invalid request line");
    }
  }
  parsedBuffer.push(line.subarray(offset));
  if (
    parsedBuffer.length !== 3 ||
    parsedBuffer[1].length === 0 ||
    parsedBuffer[2].length === 0
  ) {
    throw new HTTPError(400, "invalid request line");
  }

  return [
    decoder.decode(parsedBuffer[0]),
    parsedBuffer[1],
    decoder.decode(parsedBuffer[2]),
  ];
}

function validateHeaderName(h: Buffer): Boolean {
  const separators = new Set<number>(
    [
      "(",
      ")",
      "<",
      ">",
      "@",
      ",",
      ";",
      "\\",
      '"',
      "/",
      "[",
      "]",
      "?",
      "=",
      "{",
      "}",
      " ",
      "\t",
    ].map((sep) => sep.charCodeAt(0))
  );

  const ctlArray = Array.from(Array(32).keys());
  ctlArray.push(127); // DEL char

  let idx = h.indexOf(":");
  if (idx === -1) {
    return false;
  }
  const tokenBuffer = h.subarray(0, idx);
  if (tokenBuffer.length === 0) {
    return false;
  }
  idx = tokenBuffer.indexOf(":");
  if (idx !== -1) {
    return false;
  }
  for (const byte of tokenBuffer) {
    if (byte <= 31 || byte === 127) {
      return false;
    }
    if (separators.has(byte)) {
      return false;
    }
  }
  return true;
}
