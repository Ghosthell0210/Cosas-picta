import { parentPort, workerData } from 'node:worker_threads';
import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { SocksClient } = require('telegram/extensions/socks');
const { Logger, LogLevel } = require('telegram/extensions/Logger');
const bigInt = require('big-integer');

const CLOSE_ERROR = new Error('NetSocket was closed');
const CHUNK_TIMEOUT_MS = 22_000;

function installNativeAesInWorker() {
  try {
    const nativeMod = require('@mtkruto/ige-native');
    const igeModule = require('telegram/crypto/IGE');
    const helpersModule = require('telegram/Helpers');
    if (
      nativeMod &&
      typeof nativeMod.ige256Encrypt === 'function' &&
      typeof nativeMod.ige256Decrypt === 'function' &&
      igeModule &&
      typeof igeModule.IGE === 'function'
    ) {
      const OriginalIGE = igeModule.IGE;
      const { ige256Encrypt, ige256Decrypt } = nativeMod;
      const testKey = Buffer.alloc(32, 7);
      const testIv = Buffer.alloc(32, 9);
      const testPlain = Buffer.alloc(32, 3);
      const testCipher = Buffer.from(ige256Encrypt(testPlain, testKey, testIv));
      const testDec = Buffer.from(ige256Decrypt(testCipher, testKey, testIv));
      if (!testDec.equals(testPlain)) return false;

      class WorkerNativeIGE {
        constructor(key, iv) {
          this.keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
          this.ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
          this.fallbackInstance = null;
        }
        decryptIge(cipherText) {
          const input = Buffer.isBuffer(cipherText) ? cipherText : Buffer.from(cipherText);
          if (input.length === 0) return Buffer.alloc(0);
          try {
            return Buffer.from(ige256Decrypt(input, this.keyBuf, this.ivBuf));
          } catch {
            if (!this.fallbackInstance) {
              this.fallbackInstance = new OriginalIGE(this.keyBuf, this.ivBuf);
            }
            return this.fallbackInstance.decryptIge(input);
          }
        }
        encryptIge(plainText) {
          let input = Buffer.isBuffer(plainText) ? plainText : Buffer.from(plainText);
          const rem = input.length % 16;
          if (rem) {
            input = Buffer.concat([input, helpersModule.generateRandomBytes(16 - rem)]);
          }
          try {
            return Buffer.from(ige256Encrypt(input, this.keyBuf, this.ivBuf));
          } catch {
            if (!this.fallbackInstance) {
              this.fallbackInstance = new OriginalIGE(this.keyBuf, this.ivBuf);
            }
            return this.fallbackInstance.encryptIge(input);
          }
        }
      }

      igeModule.IGE = WorkerNativeIGE;
      return true;
    }
  } catch {
    // Fallback to pure-JS @cryptography/aes
  }
  return false;
}

class WorkerFastNetSocket {
  constructor(proxy) {
    this.client = undefined;
    this.closed = true;
    this.chunkQueue = [];
    this.headOffset = 0;
    this.bufferedBytes = 0;
    this.canReadResolve = null;
    this.canReadPromise = null;
    if (proxy && !('MTProxy' in proxy)) {
      this.proxy = proxy;
    }
  }

  _resetReadWaiter() {
    this.canReadPromise = new Promise((resolve) => {
      this.canReadResolve = resolve;
    });
  }

  _wakeReader(ok) {
    if (this.canReadResolve) {
      const resolve = this.canReadResolve;
      this.canReadResolve = null;
      this.canReadPromise = null;
      resolve(ok);
    }
  }

  _waitForData() {
    if (this.bufferedBytes > 0) return Promise.resolve(true);
    if (this.closed) return Promise.resolve(false);
    if (!this.canReadPromise) this._resetReadWaiter();
    return this.canReadPromise;
  }

  _consumeBytes(count) {
    const take = Math.min(count, this.bufferedBytes);
    if (take <= 0) return Buffer.alloc(0);

    const first = this.chunkQueue[0];
    const firstAvail = first.length - this.headOffset;
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

  async readExactly(number) {
    if (number <= 0) return Buffer.alloc(0);
    while (this.bufferedBytes < number) {
      if (this.closed) throw CLOSE_ERROR;
      const ok = await this._waitForData();
      if (!ok && this.bufferedBytes < number) throw CLOSE_ERROR;
    }
    return this._consumeBytes(number);
  }

  async read(number) {
    if (this.closed && this.bufferedBytes === 0) throw CLOSE_ERROR;
    if (this.bufferedBytes === 0) {
      const ok = await this._waitForData();
      if (!ok || (this.closed && this.bufferedBytes === 0)) throw CLOSE_ERROR;
    }
    return this._consumeBytes(number);
  }

  async readAll() {
    if (this.closed && this.bufferedBytes === 0) throw CLOSE_ERROR;
    if (this.bufferedBytes === 0) {
      const ok = await this._waitForData();
      if (!ok) throw CLOSE_ERROR;
    }
    return this._consumeBytes(this.bufferedBytes);
  }

  async connect(port, ip) {
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
          // Ignore
        }
      };

      const attachHandlers = () => {
        sock.on('data', (chunk) => {
          if (!chunk || chunk.length === 0) return;
          this.chunkQueue.push(chunk);
          this.bufferedBytes += chunk.length;
          this._wakeReader(true);
        });
        sock.on('close', () => {
          this.closed = true;
          this._wakeReader(false);
        });
      };

      let settled = false;
      sock.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.closed = true;
        this._wakeReader(false);
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

  write(data) {
    if (this.closed) throw CLOSE_ERROR;
    if (this.client) this.client.write(data);
  }

  async close() {
    this.closed = true;
    this._wakeReader(false);
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

  toString() {
    return 'WorkerFastNetSocket';
  }
}

function decryptTelegramCdnBytes(cipherBytes, encryptionKey, encryptionIv, offsetBytes) {
  const iv = Buffer.from(encryptionIv);
  if (iv.length !== 16) {
    throw new Error(`Invalid CDN encryptionIv length: ${iv.length}`);
  }
  const blockIncrement = BigInt(Math.floor(Math.max(0, offsetBytes) / 16));
  if (blockIncrement > 0n) {
    let carry = blockIncrement;
    for (let i = 15; i >= 0 && carry > 0n; i--) {
      const sum = BigInt(iv[i]) + (carry & 0xffn);
      iv[i] = Number(sum & 0xffn);
      carry = (carry >> 8n) + (sum >> 8n);
    }
  }
  const decipher = crypto.createDecipheriv('aes-256-ctr', encryptionKey, iv);
  return Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
}

function clearExportedSenderReleaseTimer(client, dcId) {
  const timers = client?._exportedSenderReleaseTimeouts;
  if (timers && typeof timers.get === 'function') {
    const t = timers.get(dcId);
    if (t) {
      clearTimeout(t);
      timers.delete(dcId);
    }
  }
}

async function main() {
  const nativeAesActive = installNativeAesInWorker();
  const {
    slotIndex,
    apiId,
    apiHash,
    sessionString,
    targetDcId,
    outputFilePath,
    doc,
  } = workerData;

  let fileHandle = null;
  let client = null;
  let keepaliveTimer = null;
  let shuttingDown = false;
  let currentDcId = Number(targetDcId) || 1;
  let currentFileRef = Buffer.from(doc.fileReferenceBase64 || '', 'base64');
  let cdnRedirectState = null;

  const resolveSender = async (dcId) => {
    if (!client) throw new Error('Worker client not initialized');
    const homeDc = Number(client.session?.dcId) || 0;
    if (homeDc && Number(dcId) === homeDc) {
      return client._sender || (await client.getSender(undefined));
    }
    const sender = await client.getSender(dcId);
    clearExportedSenderReleaseTimer(client, dcId);
    return sender;
  };

  const buildInputLocation = () => {
    const id = bigInt(String(doc.id));
    const accessHash = bigInt(String(doc.accessHash));
    if (doc.isPhoto) {
      return new Api.InputPhotoFileLocation({
        id,
        accessHash,
        fileReference: currentFileRef,
        thumbSize: doc.thumbSize || '',
      });
    }
    return new Api.InputDocumentFileLocation({
      id,
      accessHash,
      fileReference: currentFileRef,
      thumbSize: doc.thumbSize || '',
    });
  };

  const handleChunk = async (msg) => {
    if (shuttingDown) return;
    if (msg.fileReferenceBase64) {
      currentFileRef = Buffer.from(msg.fileReferenceBase64, 'base64');
    }
    if (msg.dcId && Number(msg.dcId) !== currentDcId) {
      currentDcId = Number(msg.dcId);
      cdnRedirectState = null;
    }

    const chunkStart = Date.now();
    let timeoutHandle = null;
    let timedOut = false;
    try {
      const execPromise = (async () => {
        let outBuf = null;
        let usedCdn = false;

        if (cdnRedirectState) {
          usedCdn = true;
          const cdnSender = await resolveSender(cdnRedirectState.dcId);
          let cdnRes = await client.invokeWithSender(
            new Api.upload.GetCdnFile({
              fileToken: cdnRedirectState.fileToken,
              offset: bigInt(msg.offset),
              limit: msg.requestLimit,
            }),
            cdnSender
          );
          if (cdnRes && cdnRes.className === 'upload.CdnFileReuploadNeeded') {
            const origSender = await resolveSender(currentDcId);
            await client.invokeWithSender(
              new Api.upload.ReuploadCdnFile({
                fileToken: cdnRedirectState.fileToken,
                requestToken: cdnRes.requestToken,
              }),
              origSender
            );
            cdnRes = await client.invokeWithSender(
              new Api.upload.GetCdnFile({
                fileToken: cdnRedirectState.fileToken,
                offset: bigInt(msg.offset),
                limit: msg.requestLimit,
              }),
              cdnSender
            );
          }
          if (cdnRes && cdnRes.bytes) {
            const rawBytes = Buffer.isBuffer(cdnRes.bytes) ? cdnRes.bytes : Buffer.from(cdnRes.bytes);
            outBuf = decryptTelegramCdnBytes(
              rawBytes,
              cdnRedirectState.encryptionKey,
              cdnRedirectState.encryptionIv,
              msg.offset
            );
          }
        }

        if (!outBuf) {
          const sender = await resolveSender(currentDcId);
          const req = new Api.upload.GetFile({
            location: buildInputLocation(),
            offset: bigInt(msg.offset),
            limit: msg.requestLimit,
            cdnSupported: true,
          });
          const res = await client.invokeWithSender(req, sender);
          if (res && res.className === 'upload.FileCdnRedirect') {
            usedCdn = true;
            cdnRedirectState = {
              dcId: Number(res.dcId),
              fileToken: Buffer.from(res.fileToken),
              encryptionKey: Buffer.from(res.encryptionKey),
              encryptionIv: Buffer.from(res.encryptionIv),
            };
            const cdnSender = await resolveSender(cdnRedirectState.dcId);
            let cdnRes = await client.invokeWithSender(
              new Api.upload.GetCdnFile({
                fileToken: cdnRedirectState.fileToken,
                offset: bigInt(msg.offset),
                limit: msg.requestLimit,
              }),
              cdnSender
            );
            if (cdnRes && cdnRes.className === 'upload.CdnFileReuploadNeeded') {
              await client.invokeWithSender(
                new Api.upload.ReuploadCdnFile({
                  fileToken: cdnRedirectState.fileToken,
                  requestToken: cdnRes.requestToken,
                }),
                sender
              );
              cdnRes = await client.invokeWithSender(
                new Api.upload.GetCdnFile({
                  fileToken: cdnRedirectState.fileToken,
                  offset: bigInt(msg.offset),
                  limit: msg.requestLimit,
                }),
                cdnSender
              );
            }
            if (cdnRes && cdnRes.bytes) {
              const rawBytes = Buffer.isBuffer(cdnRes.bytes) ? cdnRes.bytes : Buffer.from(cdnRes.bytes);
              outBuf = decryptTelegramCdnBytes(
                rawBytes,
                cdnRedirectState.encryptionKey,
                cdnRedirectState.encryptionIv,
                msg.offset
              );
            }
          } else if (res && res.bytes) {
            outBuf = Buffer.isBuffer(res.bytes) ? res.bytes : Buffer.from(res.bytes);
          }
        }

        if (!outBuf || outBuf.length === 0) {
          throw new Error('Respuesta de bytes vacía de Telegram');
        }
        if (timedOut || shuttingDown) {
          throw new Error('CHUNK_ABORTED_AFTER_TIMEOUT');
        }

        await fileHandle.write(outBuf, 0, outBuf.length, msg.offset);
        return { bytesWritten: outBuf.length, isCdn: usedCdn };
      })();

      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          reject(new Error(`CHUNK_TIMEOUT_${CHUNK_TIMEOUT_MS}MS`));
        }, CHUNK_TIMEOUT_MS);
      });

      const result = await Promise.race([execPromise, timeoutPromise]);
      parentPort?.postMessage({
        type: 'chunk_done',
        slotIndex,
        requestId: msg.requestId,
        index: msg.index,
        offset: msg.offset,
        expectedBytes: msg.expectedBytes,
        bytesWritten: result.bytesWritten,
        latencyMs: Math.max(1, Date.now() - chunkStart),
        isCdn: result.isCdn,
      });
    } catch (err) {
      if (cdnRedirectState) {
        cdnRedirectState = null;
      }
      const errMsg = String(err?.errorMessage || err?.message || err || 'Error desconocido');
      parentPort?.postMessage({
        type: 'chunk_error',
        slotIndex,
        requestId: msg.requestId,
        index: msg.index,
        offset: msg.offset,
        requestLimit: msg.requestLimit,
        expectedBytes: msg.expectedBytes,
        errorMessage: errMsg,
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };

  try {
    if (!sessionString || !String(sessionString).trim()) {
      throw new Error('Empty worker sessionString');
    }
    fileHandle = await fs.promises.open(outputFilePath, 'r+');
    client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
      networkSocket: WorkerFastNetSocket,
      baseLogger: new Logger(LogLevel.NONE),
    });
    await client.connect();
    const authorized = await client.isUserAuthorized();
    if (!authorized) {
      throw new Error('SESSION_UNAUTHORIZED');
    }
    const sender = await resolveSender(currentDcId);
    if (!sender) {
      throw new Error(`Unable to resolve DC #${currentDcId} sender`);
    }

    keepaliveTimer = setInterval(() => {
      if (client) {
        clearExportedSenderReleaseTimer(client, currentDcId);
        if (cdnRedirectState?.dcId) {
          clearExportedSenderReleaseTimer(client, cdnRedirectState.dcId);
        }
      }
    }, 10_000);

    parentPort?.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'chunk') {
        void handleChunk(msg);
      } else if (msg.type === 'update_state') {
        if (msg.dcId) currentDcId = Number(msg.dcId);
        if (msg.fileReferenceBase64) {
          currentFileRef = Buffer.from(msg.fileReferenceBase64, 'base64');
        }
      } else if (msg.type === 'shutdown') {
        shuttingDown = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        void (async () => {
          try {
            if (fileHandle) await fileHandle.close().catch(() => {});
          } catch {
            // Ignore
          }
          try {
            if (client) await client.disconnect().catch(() => {});
          } catch {
            // Ignore
          }
          process.exit(0);
        })();
      }
    });

    parentPort?.postMessage({
      type: 'ready',
      slotIndex,
      nativeAesActive,
      homeDcId: Number(client.session?.dcId) || currentDcId,
    });
  } catch (err) {
    const errMsg = String(err?.errorMessage || err?.message || err || 'Worker init failed');
    parentPort?.postMessage({
      type: 'init_error',
      slotIndex,
      errorMessage: errMsg,
    });
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    try {
      if (fileHandle) await fileHandle.close().catch(() => {});
    } catch {
      // Ignore
    }
    try {
      if (client) await client.disconnect().catch(() => {});
    } catch {
      // Ignore
    }
    process.exit(1);
  }
}

void main();
