import crypto from 'node:crypto';
import { createRequire } from 'node:module';

let patchAttempted = false;
let nativeActive = false;
let backendLabel = 'JS (@cryptography/aes)';

/**
 * Patches GramJS's IGE class (used on every MTProto 2.0 packet by MTProtoState)
 * with @mtkruto/ige-native's prebuilt C++ AES-NI Node-API addon (~500+ MB/s per core),
 * falling back cleanly to original pure-JS @cryptography/aes if unavailable.
 */
export function installNativeMtprotoAesPatch(): {
  nativeActive: boolean;
  backendLabel: string;
} {
  if (patchAttempted) {
    return { nativeActive, backendLabel };
  }
  patchAttempted = true;

  try {
    const req = createRequire(import.meta.url);
    const nativeMod = req('@mtkruto/ige-native') as {
      ige256Encrypt?: (data: Uint8Array, key: Uint8Array, iv: Uint8Array) => Uint8Array;
      ige256Decrypt?: (data: Uint8Array, key: Uint8Array, iv: Uint8Array) => Uint8Array;
    };
    const igeModule = req('telegram/crypto/IGE') as { IGE: any };
    const helpersModule = req('telegram/Helpers') as {
      generateRandomBytes: (len: number) => Buffer;
    };

    if (
      nativeMod &&
      typeof nativeMod.ige256Encrypt === 'function' &&
      typeof nativeMod.ige256Decrypt === 'function' &&
      igeModule &&
      typeof igeModule.IGE === 'function'
    ) {
      const OriginalIGE = igeModule.IGE;
      const { ige256Encrypt, ige256Decrypt } = nativeMod;

      // Smoke-test once before replacing module export
      const testKey = Buffer.alloc(32, 7);
      const testIv = Buffer.alloc(32, 9);
      const testPlain = Buffer.alloc(32, 3);
      const testCipher = Buffer.from(ige256Encrypt(testPlain, testKey, testIv));
      const testDec = Buffer.from(ige256Decrypt(testCipher, testKey, testIv));
      if (!testDec.equals(testPlain)) {
        throw new Error('AES-IGE native self-test mismatch');
      }

      class NativeAcceleratedIGE {
        private keyBuf: Buffer;
        private ivBuf: Buffer;
        private fallbackInstance: any = null;

        constructor(key: Buffer, iv: Buffer) {
          this.keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
          this.ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv);
        }

        decryptIge(cipherText: Buffer): Buffer {
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

        encryptIge(plainText: Buffer): Buffer {
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

      igeModule.IGE = NativeAcceleratedIGE;
      nativeActive = true;
      backendLabel = 'AES-NI Nativo (C++ Node-API)';
    }
  } catch {
    nativeActive = false;
    backendLabel = 'JS (@cryptography/aes)';
  }

  return { nativeActive, backendLabel };
}

/**
 * Decrypts Telegram upload.cdnFile bytes using native OpenSSL AES-256-CTR.
 * Per MTProto CDN spec, IV counter is incremented by (offset / 16) in big-endian.
 */
export function decryptTelegramCdnBytes(
  cipherBytes: Buffer,
  encryptionKey: Buffer,
  encryptionIv: Buffer,
  offsetBytes: number
): Buffer {
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
