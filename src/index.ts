import { assert } from "console";
import { Socket } from "dgram";
import { IncomingMessage } from "http";
import * as net from "net";
import { hostname } from "os";
import { constrainedMemory } from "process";

type TCPConn = {
  socket: net.Socket;
  err: null | Error;
  ended: boolean;
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

type AcceptItem = {
  resolve: (value: TCPConn) => void;
  reject: (reason: Error) => void;
};

type TCPListener = {
  server: net.Server;
  incoming: net.Socket[];
  accepts: AcceptItem[];
};

type ListenOptions = {
  host: string;
  port: number;
};

function soListen(options: ListenOptions): TCPListener {
  const { host, port } = options;
  const listener = {
    server: net.createServer({ pauseOnConnect: true }),
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

function soRead(conn: TCPConn): Promise<Buffer> {
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

function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
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

// echo server
async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = soInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };
  while (true) {
    const msg: null | Buffer = cutMessage(buf);
    if (!msg) {
      const data = await soRead(conn);
      bufPush(buf, data);
      if (data.length === 0) {
        console.log("end connection");
        break;
      }
      continue;
    }
    if (msg.equals(Buffer.from("quit\n"))) {
      await soWrite(conn, Buffer.from("Bye\n"));
      socket.destroy();
      return;
    } else {
      const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
      await soWrite(conn, reply);
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
  } finally {
    conn.socket.destroy();
  }
}

const listener = soListen({ host: "127.0.0.1", port: 1234 });
while (true) {
  const conn = await soAccept(listener);
  newConn(conn);
}
