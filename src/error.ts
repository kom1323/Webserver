export class HTTPError extends Error {
  public statusCode: number;
  constructor(statusCode: number, msg: string) {
    super(msg);

    this.name = "HTTPError";
    this.statusCode = statusCode;

    Object.setPrototypeOf(this, HTTPError.prototype);
  }
}
