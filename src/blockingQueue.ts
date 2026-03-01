type Queue<T> = {
    pushBack(item: T): Promise<void>;
    popFront(): Promise<T | null>;
    close(): void;
};

// a multi-producer, multi-consumer, and 0-capacity queue.
function createQueue<T>(): Queue<T> {
    type Taker = (item: T | null) => void; // fulfill a consumer
    type Giver = (take: Taker) => void; // wake up a producer
    type Rejector = (err: Error) => void;
    const producers: { give: Giver; reject: Rejector }[] = [];
    const consumers: Taker[] = [];
    let closed = false;
    return {
        pushBack: (item: T): Promise<void> => {
            return new Promise<void>((done: () => void) => {
                const give: Giver = (take: Taker) => {
                    take(item);
                    done();
                };
                const reject: Rejector = (err: Error) => {
                    throw err;
                };
                if (closed) {
                }
                if (consumers.length) {
                    // consumers are waiting
                    give(consumers.shift()!);
                } else {
                    producers.push({ give, reject });
                }
            });
        },
        popFront: (): Promise<T | null> => {
            return new Promise<T | null>((take: Taker) => {
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
