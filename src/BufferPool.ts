export default class BufferPool {
  private static instance: BufferPool;
  private pool: Buffer[] = [];
  private readonly BufferSize: number = 8192; //8KB

  private constructor(poolSize: number) {
    for (let i = 0; i < poolSize; i++) {
      this.pool.push(Buffer.alloc(this.BufferSize));
    }
  }

  public static getInstance(poolSize = 10): BufferPool {
    if (!this.instance) {
      this.instance = new BufferPool(poolSize);
    }
    return this.instance;
  }

  public borrow(): Buffer | undefined {
    return this.pool.pop();
  }

  public return(buf: Buffer): void {
    this.pool.push(buf);
  }

  public getBufferSize() {
    return this.BufferSize;
  }
}
