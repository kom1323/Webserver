import * as net from "net";

export type TCPConn = {
    socket: net.Socket;
    err: null | Error;
    ended: boolean;
    reader: null | {
        resolve: (value: Buffer) => void;
        reject: (reason: Error) => void;
    };
};

export type AcceptItem = {
    resolve: (value: TCPConn) => void;
    reject: (reason: Error) => void;
};

export type TCPListener = {
    server: net.Server;
    incoming: net.Socket[];
    accepts: AcceptItem[];
};

export type ListenOptions = {
    host: string;
    port: number;
};

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
    //optional cleanups
    close?: () => Promise<void>;
};

// range-spec = int-range
//               / suffix-range
//               / other-range
// int-range = first-pos "-" [ last-pos ]
// suffix-range = "-" suffix-length
export type HTTPRange = [number, number | null] | number;

// WebSocket message type
export type WSMsg = {
    type: number; // WS_DATA_TEXT, WS_DATA_BINARY
    length: number; // in bytes; 01 if fragmented
    read: () => Promise<Buffer>; // empty after EOF
};

// The WebSocket API
export type WSServer = {
    send(msg: WSMsg): Promise<void>; // supports multiple producers
    recv(): Promise<null | WSMsg>; // null after EOF
    close(): void;
};
