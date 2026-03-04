# HTTP/WebSocket Server From Scratch

A fully-featured HTTP/1.1 and WebSocket server built from scratch in Node.js with TypeScript — no frameworks, no external runtime dependencies. Built by following [_Build Your Own Web Server From Scratch in Node.JS_](https://build-your-own.org) by James Smith.

## Features

### HTTP/1.1 Protocol

- Full request/response parsing (method, URI, headers, body)
- **GET**, **HEAD**, **POST** method support
- **Keep-Alive** persistent connections
- **Chunked Transfer Encoding** for both requests and responses
- **Gzip Compression** with route-configurable flush strategies (streaming vs. high compression)

### Static File Serving

- Serve files from the `files/` directory via the `/files/` endpoint
- **Range Requests** (HTTP 206 Partial Content) with byte-range support
- **Conditional Requests** — `If-Modified-Since` / `Last-Modified` for 304 Not Modified responses
- **If-Range** support for conditional range requests
- Directory traversal protection

### WebSocket (RFC 6455)

- HTTP → WebSocket upgrade handshake (101 Switching Protocols)
- Text and Binary frame types
- Control frames: CLOSE, PING/PONG
- Frame masking/unmasking
- Variable-length payload encoding (7-bit, 16-bit, 64-bit)
- Built-in echo application for testing

### Internals

- **Buffer Pool** — two-tier memory pooling (8KB normal / 64KB large buffers) to reduce allocation overhead
- **Dynamic Buffer** — auto-growing buffers with pool integration
- **Blocking Queue** — multi-producer/multi-consumer queue with backpressure for WebSocket communication
- **Buffered Writer** — batched socket writes with automatic flushing

## Endpoints

| Endpoint                    | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `GET /`                     | Returns `"hello world."`                                   |
| `POST /echo`                | Echoes back the request body                               |
| `GET /sheep`                | Streams numbers 0–99 with 1-second delays (chunked + gzip) |
| `GET /files/<path>`         | Serves static files with range & caching support           |
| `GET /` (WebSocket Upgrade) | Upgrades to WebSocket, runs echo app                       |

## Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) (ES2022+ support)
- [pnpm](https://pnpm.io/)

### Setup

```bash
# Clone the repository
git clone https://github.com/kom1323/Webserver.git
cd Webserver

# Install dependencies
pnpm install

# Start the server
pnpm start
```

The server will listen on `http://127.0.0.1:1234`.

### Development (with hot reload)

```bash
pnpm run dev
```

### Usage Examples

```bash
# Simple GET
curl http://localhost:1234/

# POST with echo
curl -X POST -d "hello world" http://localhost:1234/echo

# Stream (chunked + gzip)
curl --compressed http://localhost:1234/sheep

# Static file with range request
curl -H "Range: bytes=0-99" http://localhost:1234/files/test_file.txt

# WebSocket (using websocat)
websocat ws://127.0.0.1:1234/
```

#### WebSocket in the Browser

Open the browser console and run:

```js
const socket = new WebSocket('ws://localhost:1234/');

socket.onopen = () => {
    console.log('Connected to your server!');
    socket.send('Testing my WebSocket implementation!');
};

socket.onmessage = (event) => {
    console.log('Server echoed:', event.data);
};

socket.onclose = () => console.log('Connection closed');
```

## Project Structure

```
src/
├── index.ts          # TCP server setup & request routing
├── message.ts        # HTTP request parsing & response writing
├── websocket.ts      # WebSocket protocol implementation
├── blockingQueue.ts  # Multi-producer/consumer queue
├── fileIO.ts         # Static file serving & range requests
├── stream.ts         # Gzip compression handling
├── BufferPool.ts     # Memory buffer pooling
├── dynamicBuffer.ts  # Auto-growing buffer
├── sheep.ts          # Streaming demo endpoint
├── config.ts         # Route configuration
├── error.ts          # HTTP error class
└── types/index.ts    # TypeScript type definitions
```

## Built With

- **TypeScript** — strict mode, ES2022 target
- **Node.js built-in modules only** — `net`, `fs`, `stream`, `zlib`, `crypto`, `path`
- Zero runtime dependencies
