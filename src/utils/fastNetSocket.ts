import net from 'node:net';
import { SocksClient } from 'telegram/extensions/socks.js';

const CLOSE_ERROR = new Error('NetSocket was closed');

/**
 * Drop-in replacement for GramJS PromisedNetSockets that removes:
 * 1) The process-wide module-level async-mutex shared across all sockets.
 * 2) The O(N^2) Buffer.concat() executed on every incoming 16-64 KB TCP packet.
 *
 * Uses an O(1) per-socket Buffer chunk queue with exact byte consumption and TCP_NODELAY.
 */
export class FastPromisedNetSockets {
  client: net.Socket | undefined = undefined;
  closed = true;
  proxy?: any;

  private chunkQueue: Buffer[] = [];
  private headOffset = 0;
  private bufferedBytes = 0;
  private canReadResolve: ((ok: boolean) => void) | null = null;
  private canReadPromise: Promise<boolean> | null = null;

  constructor(proxy?: any) {
    if (proxy && !('MTProxy' in proxy)) {
      if (!proxy.ip || !proxy.port || !proxy.socksType) {
        throw new Error(
          `Invalid sockets params: ip=${proxy.ip}, port=${proxy.port}, socksType=${proxy.socksType}`
        );
      }
      this.proxy = proxy;
    }
  }

  private resetReadWaiter(): void {
    this.canReadPromise = new Promise<boolean>((resolve) => {
      this.canReadResolve = resolve;
    });
  }

  private wakeReader(ok: boolean): void {
    if (this.canReadResolve) {
      const resolve = this.canReadResolve;
      this.canReadResolve = null;
      this.canReadPromise = null;
      resolve(ok);
    }
  }

  private waitForData(): Promise<boolean> {
    if (this.bufferedBytes > 0) {
      return Promise.resolve(true);
    }
    if (this.closed) {
      return Promise.resolve(false);
    }
    if (!this.canReadPromise) {
      this.resetReadWaiter();
    }
    return this.canReadPromise!;
  }

  private consumeBytes(count: number): Buffer {
    const take = Math.min(count, this.bufferedBytes);
    if (take <= 0) return Buffer.alloc(0);

    const first = this.chunkQueue[0];
    const firstAvail = first.length - this.headOffset;

    // Fast path: requested slice lives entirely inside the head Buffer (zero-copy subarray)
    if (firstAvail >= take) {
      const out = first.subarray(this.headOffset, this.headOffset + take);
      this.headOffset += take;
      this.bufferedBytes -= take;
      if (this.headOffset >= first.length) {
        this.chunkQueue.shift();
        this.headOffset = 0;
      }
      return out;
    }

    // Multi-chunk assembly with a single exact allocation
    const out = Buffer.allocUnsafe(take);
    let written = 0;
    while (written < take && this.chunkQueue.length > 0) {
      const head = this.chunkQueue[0];
      const avail = head.length - this.headOffset;
      const toCopy = Math.min(avail, take - written);
      head.copy(out, written, this.headOffset, this.headOffset + toCopy);
      written += toCopy;
      this.headOffset += toCopy;
      this.bufferedBytes -= toCopy;
      if (this.headOffset >= head.length) {
        this.chunkQueue.shift();
        this.headOffset = 0;
      }
    }
    return out;
  }

  async readExactly(number: number): Promise<Buffer> {
    if (number <= 0) return Buffer.alloc(0);
    while (this.bufferedBytes < number) {
      if (this.closed) {
        throw CLOSE_ERROR;
      }
      const ok = await this.waitForData();
      if (!ok && this.bufferedBytes < number) {
        throw CLOSE_ERROR;
      }
    }
    return this.consumeBytes(number);
  }

  async read(number: number): Promise<Buffer> {
    if (this.closed && this.bufferedBytes === 0) {
      throw CLOSE_ERROR;
    }
    if (this.bufferedBytes === 0) {
      const ok = await this.waitForData();
      if (!ok || (this.closed && this.bufferedBytes === 0)) {
        throw CLOSE_ERROR;
      }
    }
    return this.consumeBytes(number);
  }

  async readAll(): Promise<Buffer> {
    if (this.closed && this.bufferedBytes === 0) {
      throw CLOSE_ERROR;
    }
    if (this.bufferedBytes === 0) {
      const ok = await this.waitForData();
      if (!ok) {
        throw CLOSE_ERROR;
      }
    }
    return this.consumeBytes(this.bufferedBytes);
  }

  async connect(port: number, ip: string, _testServers?: boolean): Promise<unknown> {
    this.chunkQueue = [];
    this.headOffset = 0;
    this.bufferedBytes = 0;
    this.canReadResolve = null;
    this.canReadPromise = null;

    let preConnected = false;
    if (this.proxy) {
      const info = await SocksClient.createConnection({
        proxy: {
          host: this.proxy.ip,
          port: this.proxy.port,
          type: this.proxy.socksType,
          userId: this.proxy.username,
          password: this.proxy.password,
        },
        command: 'connect',
        timeout: (this.proxy.timeout || 5) * 1000,
        destination: { host: ip, port },
      });
      this.client = info.socket;
      preConnected = true;
    } else {
      this.client = new net.Socket();
    }

    this.closed = false;

    return new Promise((resolve, reject) => {
      const sock = this.client;
      if (!sock) {
        reject(new Error('Socket failed to initialize'));
        return;
      }

      const tuneSocket = () => {
        try {
          sock.setNoDelay(true);
          sock.setKeepAlive(true, 10_000);
        } catch {
          // Non-fatal socket option fallback
        }
      };

      const attachHandlers = () => {
        sock.on('data', (chunk: Buffer) => {
          if (!chunk || chunk.length === 0) return;
          this.chunkQueue.push(chunk);
          this.bufferedBytes += chunk.length;
          this.wakeReader(true);
        });

        sock.on('close', () => {
          this.closed = true;
          this.wakeReader(false);
        });
      };

      let settled = false;
      sock.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.closed = true;
        this.wakeReader(false);
      });

      if (preConnected) {
        settled = true;
        tuneSocket();
        attachHandlers();
        resolve(this);
      } else {
        sock.connect(port, ip, () => {
          if (!settled) {
            settled = true;
            tuneSocket();
            attachHandlers();
            resolve(this);
          }
        });
      }
    });
  }

  write(data: Buffer | Uint8Array): void {
    if (this.closed) {
      throw CLOSE_ERROR;
    }
    if (this.client) {
      this.client.write(data);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.wakeReader(false);
    if (this.client) {
      try {
        this.client.destroy();
        this.client.unref();
      } catch {
        // Ignore
      }
    }
    this.chunkQueue = [];
    this.headOffset = 0;
    this.bufferedBytes = 0;
  }

  toString(): string {
    return 'FastPromisedNetSocket';
  }
}
