export enum BufferTier {
    Normal = 8192, // 8KB
    Big = 655536, // 64KB
}
export default class BufferPool {
    private static instance: BufferPool;
    private normalPool: Buffer[] = [];
    private bigPool: Buffer[] = [];

    private constructor(poolSize: number, bigPoolSize: number) {
        for (let i = 0; i < poolSize; i++) {
            this.normalPool.push(Buffer.allocUnsafe(BufferTier.Normal));
        }
        for (let i = 0; i < bigPoolSize; i++) {
            this.bigPool.push(Buffer.allocUnsafe(BufferTier.Big));
        }
    }

    public static getInstance(poolSize = 10, bigPoolSize = 2): BufferPool {
        if (!this.instance) {
            this.instance = new BufferPool(poolSize, bigPoolSize);
        }
        return this.instance;
    }

    public borrow(tier: BufferTier = BufferTier.Normal): Buffer | undefined {
        return tier === BufferTier.Big
            ? this.bigPool.pop()
            : this.normalPool.pop();
    }

    public return(buf: Buffer): void {
        if (buf.length === BufferTier.Big) {
            this.bigPool.push(buf);
        } else {
            this.normalPool.push(buf);
        }
    }
}
