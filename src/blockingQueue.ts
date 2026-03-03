type Queue<T> = {
    pushBack(item: T): Promise<void>;
    popFront(): Promise<T | null>;
    close(): void;
};

// a multi-producer, multi-consumer, and 0-capacity queue.
function createQueue<T>(capacity: number): Queue<T> {
    type Taker = (item: T | null) => void; // fulfill a consumer
    type Giver = (take: Taker) => void; // wake up a producer
    type Rejector = (err: Error) => void;
    const producers: { give: Giver; reject: Rejector }[] = [];
    const consumers: Taker[] = [];
    let closed = false;
    return {
        pushBack: (item: T): Promise<void> => {
            return new Promise<void>((done: () => void, reject) => {
                if (capacity === 0) {
                    return reject(new Error("queue full"));
                }
                if (closed) {
                    return reject(new Error("queue closed."));
                }
                const give: Giver = (take: Taker) => {
                    take(item);
                    done();
                };
                if (consumers.length) {
                    // consumers are waiting
                    capacity++;
                    give(consumers.shift()!);
                } else {
                    capacity--;
                    producers.push({ give, reject });
                }
            });
        },
        popFront: (): Promise<T | null> => {
            return new Promise<T | null>((take: Taker, reject) => {
                if (closed) {
                    return take(null);
                }
                if (producers.length) {
                    // producers are waiting
                    producers.shift()!.give(take);
                } else {
                    // wait for a consumer
                    consumers.push(take);
                }
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
