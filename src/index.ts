import * as net from "net";
import {
  cutMessage,
  soRead,
  readerFromMemory,
  writeHTTPResp,
  readerFromReq,
  handleReq,
} from "./message";
import { bufPush } from "./dynamicBuffer";
import { HTTPError } from "./error";
import type {
  ListenOptions,
  TCPListener,
  TCPConn,
  DynBuf,
  HTTPReq,
  HTTPRes,
  BodyReader,
} from "./types";

function soListen(options: ListenOptions): TCPListener {
  const { host, port } = options;
  const listener = {
    server: net.createServer(),
    incoming: [],
    accepts: [],
  } as TCPListener;

  listener.server.on("connection", (socket: net.Socket) => {
    const nextPromise = listener.accepts.shift();
    if (nextPromise) {
      nextPromise.resolve(soInit(socket));
    } else {
      listener.incoming.push(socket);
    }
  });
  listener.server.listen(port, host);
  return listener;
}

function soAccept(listener: TCPListener): Promise<TCPConn> {
  return new Promise((resolve, reject) => {
    const nextSocket = listener.incoming.shift();
    if (nextSocket) {
      resolve(soInit(nextSocket));
    } else {
      listener.accepts.push({ resolve: resolve, reject: reject });
    }
  });
}

function soInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket: socket,
    err: null,
    ended: false,
    reader: null,
  };
  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader);
    conn.socket.pause();
    conn.reader!.resolve(data);
    conn.reader = null;
  });
  socket.on("end", () => {
    conn.ended = true;
    if (conn.reader) {
      conn.reader.resolve(Buffer.from(""));
      conn.reader = null;
    }
  });
  socket.on("error", (err: Error) => {
    conn.err = err;
    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });
  return conn;
}
// echo server
async function serveClient(conn: TCPConn): Promise<void> {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0, pos: 0 };
  while (true) {
    const msg: null | HTTPReq = cutMessage(buf);
    if (!msg) {
      const data = await soRead(conn);
      bufPush(buf, data);
      if (data.length === 0 && buf.length - buf.pos === 0) {
        return; // no more requests
      }
      if (data.length === 0) {
        throw new HTTPError(400, "Enexcpected EOF.");
      }
      continue;
    }
    const reqBody: BodyReader = readerFromReq(conn, buf, msg);
    const res: HTTPRes = await handleReq(msg, reqBody);
    await writeHTTPResp(conn, res);
    // close the connection for HTTP/1.0
    if (msg.version === "1.0") {
      return;
    }

    while ((await reqBody.read()).length > 0) {
      /* empty */
    }
  }
}

async function newConn(conn: TCPConn): Promise<void> {
  console.log(
    "new connection",
    conn.socket.remoteAddress,
    conn.socket.remotePort
  );
  try {
    await serveClient(conn);
  } catch (exc) {
    console.error("exception: ", exc);
    if (exc instanceof HTTPError) {
      const resp: HTTPRes = {
        code: exc.statusCode,
        headers: [],
        body: readerFromMemory(Buffer.from(exc.message + "\n")),
      };
      try {
        await writeHTTPResp(conn, resp);
      } catch (exc) {
        /* ignore */
      }
    }
  } finally {
    conn.socket.destroy();
  }
}

const listener = soListen({ host: "127.0.0.1", port: 1234 });
while (true) {
  const conn = await soAccept(listener);
  newConn(conn);
}
