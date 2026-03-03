type Queue<T> = {
    pushBack(item: T): Promise<void>;
    popFront(): Promise<T | null>;
    close(): void;
};

// a multi-producer, multi-consumer, and n-capacity queue.
function createQueue<T>(capacity: number): Queue<T> {
    type Taker = (item: T | null) => void; // fulfill a consumer
    type Rejector = (err: Error) => void;
    type resolver = () => void;
    const buffer: T[] = [];
    const producers: { done: resolver; reject: Rejector; item: T }[] = [];
    const consumers: Taker[] = [];
    let closed = false;
    return {
        pushBack: (item: T): Promise<void> => {
            return new Promise<void>((done: () => void, reject) => {
                if (closed) {
                    return reject(new Error("queue closed."));
                }

                if (consumers.length) {
                    consumers.shift()!(item);
                    return done();
                }
                if (buffer.length < capacity) {
                    buffer.push(item);
                    return done();
                }
                producers.push({ done, reject, item });
            });
        },
        popFront: (): Promise<T | null> => {
            return new Promise<T | null>((take: Taker) => {
                if (closed) {
                    return take(null);
                }
                if (buffer.length) {
                    take(buffer.shift()!);
                    if (producers.length) {
                        const nextProducer = producers.shift()!;
                        buffer.push(nextProducer.item);
                        return nextProducer.done();
                    }
                    return;
                }

                if (producers.length) {
                    const nextProducer = producers.shift()!;
                    take(nextProducer.item);
                    return nextProducer.done();
                }
                // wait for a consumer
                consumers.push(take);
            });
        },
        close: () => {
            // unblock any waiting producers or consumers
            if (closed) return;
            closed = true;
            while (producers.length) {
                producers.shift()!.reject(new Error("queue closed."));
            }
            while (consumers.length) {
                consumers.shift()!(null);
            }
        },
    };
}
