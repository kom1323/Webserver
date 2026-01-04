import { HTTPError } from "./error";
import type { DynBuf, HTTPReq, TCPConn, BodyReader, HTTPRes } from "./types";
import {
  BufferedWriter,
  bufPop,
  bufPush,
  createBufferedWriter,
} from "./dynamicBuffer";
import BufferPool from "./BufferPool";

const kMaxHeaderLen = 1024 * 8;
const crlfBuffer = Buffer.from("\r\n");

export function cutMessage(buf: DynBuf): null | HTTPReq {
  const idx = buf.data.subarray(buf.pos, buf.length).indexOf("\r\n\r\n");
  if (idx < 0) {
    if (buf.length - buf.pos >= kMaxHeaderLen) {
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

// send an HTTP response through the socket
export async function writeHTTPResp(
  conn: TCPConn,
  resp: HTTPRes
): Promise<void> {
  if (resp.body.length < 0) {
    throw new Error("TODO: chunked encoding");
  }
  // set the "Content-Length" field
  console.assert(!fieldGet(resp.headers, "Content-Length"));
  resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));

  const respBuff = BufferPool.getInstance().borrow();
  if (!respBuff) {
    throw new HTTPError(507, "Insufficient Storage");
  }

  try {
    const writer = createBufferedWriter(conn, respBuff);
    // write the header
    await writeEncodedHTTPResp(writer, resp);
    // write the body
    while (true) {
      const data = await resp.body.read();
      if (data.length === 0) {
        break;
      }
      await writer.write(data);
    }
    await writer.flush();
  } finally {
    BufferPool.getInstance().return(respBuff);
  }
}

async function writeEncodedHTTPResp(
  writer: BufferedWriter,
  resp: HTTPRes
): Promise<void> {
  const statusLineBuffer = Buffer.from(`HTTP/1.1 ${resp.code}\r\n`);

  let totalLength = statusLineBuffer.length;
  for (const header of resp.headers) {
    totalLength += header.length;
    totalLength += crlfBuffer.length;
  }
  totalLength += crlfBuffer.length;

  if (totalLength > BufferPool.getInstance().getBufferSize()) {
    throw new HTTPError(431, "Request Header Fields Too Large");
  }

  await writer.write(statusLineBuffer);
  for (const header of resp.headers) {
    await writer.write(header);
    await writer.write(crlfBuffer);
  }

  await writer.write(crlfBuffer);
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

function fieldGet(headers: Buffer[], key: string): null | Buffer {
  const keyBuff = Buffer.from(key.toLowerCase());
  outerLoop: for (const buf of headers) {
    let idx = buf.indexOf(":");
    if (idx === -1) {
      continue outerLoop;
    }
    const headerBuf = buf.subarray(0, idx);
    let keyIndex = 0;

    if (headerBuf.length !== keyBuff.length) {
      continue outerLoop;
    }

    for (const byte of headerBuf) {
      const normalizedByte =
        byte <= "Z".charCodeAt(0) && byte >= "A".charCodeAt(0)
          ? byte + 32
          : byte;
      if (keyIndex < keyBuff.length) {
        if (normalizedByte !== keyBuff.at(keyIndex)) {
          continue outerLoop;
        }
        keyIndex++;
      } else {
        continue outerLoop;
      }
    }

    const valueBuf = buf.subarray(idx + 1);
    let valueIndex = 0;
    let valueEndIndex = valueBuf.length - 1;
    while (
      valueBuf.at(valueIndex) === " ".charCodeAt(0) ||
      valueBuf.at(valueIndex) === "\t".charCodeAt(0)
    ) {
      valueIndex++;
    }
    if (valueIndex > valueEndIndex) {
      continue outerLoop;
    }
    while (
      valueBuf.at(valueEndIndex) === " ".charCodeAt(0) ||
      valueBuf.at(valueEndIndex) === "\t".charCodeAt(0)
    ) {
      valueEndIndex--;
    }
    if (valueEndIndex < valueIndex) {
      continue outerLoop;
    }
    return valueBuf.subarray(valueIndex, valueEndIndex + 1);
  }
  return null;
}

function parseDec(numString: string): number {
  if (numString.length === 0) {
    return NaN;
  }
  if (
    numString[0].charCodeAt(0) < "0".charCodeAt(0) ||
    numString[0].charCodeAt(0) > "9".charCodeAt(0)
  ) {
    return NaN;
  }

  let num = 0;
  for (const char of numString) {
    if (
      char.charCodeAt(0) < "0".charCodeAt(0) ||
      char.charCodeAt(0) > "9".charCodeAt(0)
    ) {
      return NaN;
    }
    num = num * 10 + (char.charCodeAt(0) - "0".charCodeAt(0));
  }
  return num;
}

// BodyReader from an HTTP request
export function readerFromReq(
  conn: TCPConn,
  buf: DynBuf,
  req: HTTPReq
): BodyReader {
  let bodyLen = -1;
  const contentLen = fieldGet(req.headers, "Content-Length");
  if (contentLen) {
    bodyLen = parseDec(contentLen.toString("latin1"));
    if (isNaN(bodyLen)) {
      throw new HTTPError(400, "bad Content-Length.");
    }
  }
  const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
  const chunked =
    fieldGet(req.headers, "Transfer-Encoding")?.equals(
      Buffer.from("chunked")
    ) || false;
  if (!bodyAllowed && (bodyLen > 0 || chunked)) {
    throw new HTTPError(400, "HTTP body not allowed.");
  }
  if (!bodyAllowed) {
    bodyLen = 0;
  }
  if (bodyLen >= 0) {
    // "Content-Length" is present
    return readerFromConnLength(conn, buf, bodyLen);
  } else if (chunked) {
    // chunked encoding
    throw new HTTPError(501, "TODO: chuncked");
  } else {
    // read the rest of the connection
    throw new HTTPError(501, "TODO");
  }
}

export function soRead(conn: TCPConn): Promise<Buffer> {
  console.assert(!conn.reader);
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }
    if (conn.ended) {
      resolve(Buffer.from(""));
      return;
    }
    conn.reader = { resolve: resolve, reject: reject };
    conn.socket.resume();
  });
}

export function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0);
  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }
    conn.socket.write(data, (err?: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function readerFromConnLength(
  conn: TCPConn,
  buf: DynBuf,
  remain: number
): BodyReader {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      if (remain === 0) {
        return Buffer.from("");
      }
      if (buf.length - buf.pos === 0) {
        const data = await soRead(conn);
        bufPush(buf, data);
        if (data.length === 0) {
          // expect more data!
          throw new Error("Unexpected EOF from HTTP body");
        }
      }
      // consume data from the buffer
      const consume = Math.min(buf.length - buf.pos, remain);
      remain -= consume;
      const data = Buffer.from(buf.data.subarray(buf.pos, buf.pos + consume));
      bufPop(buf, consume);
      return data;
    },
  };
}

export async function handleReq(
  req: HTTPReq,
  body: BodyReader
): Promise<HTTPRes> {
  let resp: BodyReader;
  switch (req.uri.toString("latin1")) {
    case "/echo":
      resp = body;
      break;
    default:
      resp = readerFromMemory(Buffer.from("hello world.\n"));
      break;
  }

  return {
    code: 200,
    headers: [Buffer.from("Server: my_first_http_server")],
    body: resp,
  };
}

// BodyReader from in-memory data
export function readerFromMemory(data: Buffer): BodyReader {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (done) {
        return Buffer.from("");
      } else {
        done = true;
        return data;
      }
    },
  };
}
