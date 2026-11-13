import crypto from 'crypto';

/**
 * Noise_NNpsk0_25519_ChaChaPoly_SHA256, as used by the ESPHome native API
 * when `api: encryption: key:` is set. Implemented with Node's built-in crypto
 * (X25519, ChaCha20-Poly1305, SHA-256), following the Noise spec rev 34.
 *
 * Pattern:   -> psk, e
 *            <- e, ee
 * Both handshake payloads are empty. ESPHome uses the prologue
 * "NoiseAPIInit\0\0".
 */

export const ESPHOME_NOISE_PROTOCOL = 'Noise_NNpsk0_25519_ChaChaPoly_SHA256';
export const ESPHOME_NOISE_PROLOGUE = Buffer.from('NoiseAPIInit\x00\x00', 'binary');

const DH_LEN = 32;
const TAG_LEN = 16;
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const EMPTY = Buffer.alloc(0);

const sha256 = (...parts: Buffer[]): Buffer => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

const hmac = (key: Buffer, ...parts: Buffer[]): Buffer => {
  const h = crypto.createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return h.digest();
};

/** Noise HKDF with 2 or 3 outputs. */
const hkdf = (chainingKey: Buffer, ikm: Buffer, outputs: 2 | 3): Buffer[] => {
  const tempKey = hmac(chainingKey, ikm);
  const out1 = hmac(tempKey, Buffer.from([1]));
  const out2 = hmac(tempKey, out1, Buffer.from([2]));
  if (outputs === 2) return [out1, out2];
  const out3 = hmac(tempKey, out2, Buffer.from([3]));
  return [out1, out2, out3];
};

const nonceBytes = (n: bigint): Buffer => {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64LE(n, 4);
  return nonce;
};

const aeadEncrypt = (key: Buffer, n: bigint, ad: Buffer, plaintext: Buffer): Buffer => {
  const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonceBytes(n), { authTagLength: TAG_LEN });
  cipher.setAAD(ad, { plaintextLength: plaintext.length });
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
};

const aeadDecrypt = (key: Buffer, n: bigint, ad: Buffer, ciphertext: Buffer): Buffer => {
  if (ciphertext.length < TAG_LEN) throw new Error('Noise ciphertext shorter than the auth tag');
  const body = ciphertext.subarray(0, ciphertext.length - TAG_LEN);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonceBytes(n), { authTagLength: TAG_LEN });
  decipher.setAAD(ad, { plaintextLength: body.length });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
};

interface KeyPair {
  publicKey: Buffer;
  privateKey: crypto.KeyObject;
}

const generateKeyPair = (): KeyPair => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { publicKey: Buffer.from(der.subarray(der.length - DH_LEN)), privateKey };
};

const dh = (privateKey: crypto.KeyObject, remotePublic: Buffer): Buffer => {
  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, remotePublic]),
    format: 'der',
    type: 'spki',
  });
  return crypto.diffieHellman({ privateKey, publicKey });
};

/** Transport cipher produced by Split(); one per direction. */
export class NoiseCipherState {
  private n = 0n;

  constructor(private readonly key: Buffer) {}

  encrypt(plaintext: Buffer, ad: Buffer = EMPTY): Buffer {
    const out = aeadEncrypt(this.key, this.n, ad, plaintext);
    this.n += 1n;
    return out;
  }

  decrypt(ciphertext: Buffer, ad: Buffer = EMPTY): Buffer {
    const out = aeadDecrypt(this.key, this.n, ad, ciphertext);
    this.n += 1n;
    return out;
  }
}

export type NoiseRole = 'initiator' | 'responder';

/**
 * Two-message NNpsk0 handshake. The initiator calls writeMessage() then
 * readMessage(); the responder (used by tests as a fake device) does the reverse.
 * After the second message, split() returns { send, receive } ciphers.
 */
export class NoiseHandshake {
  private h: Buffer;
  private ck: Buffer;
  private k: Buffer | null = null;
  private n = 0n;
  private readonly e: KeyPair;
  private re: Buffer | null = null;
  private step = 0;

  constructor(
    private readonly role: NoiseRole,
    private readonly psk: Buffer,
    prologue: Buffer = ESPHOME_NOISE_PROLOGUE,
    /** Test hook: fixed ephemeral key pair. */
    ephemeral?: KeyPair,
  ) {
    if (psk.length !== 32) throw new Error('Noise PSK must be 32 bytes');
    const name = Buffer.from(ESPHOME_NOISE_PROTOCOL, 'ascii');
    this.h = name.length <= 32 ? Buffer.concat([name, Buffer.alloc(32 - name.length)]) : sha256(name);
    this.ck = Buffer.from(this.h);
    this.e = ephemeral ?? generateKeyPair();
    this.mixHash(prologue);
  }

  /** Produce the next outgoing handshake message (empty payload). */
  writeMessage(): Buffer {
    if (this.role === 'initiator' && this.step === 0) {
      // -> psk, e
      this.mixKeyAndHash(this.psk);
      this.mixHash(this.e.publicKey);
      this.mixKey(this.e.publicKey);
      this.step = 1;
      return Buffer.concat([this.e.publicKey, this.encryptAndHash(EMPTY)]);
    }
    if (this.role === 'responder' && this.step === 1) {
      // <- e, ee
      this.mixHash(this.e.publicKey);
      this.mixKey(this.e.publicKey);
      this.mixKey(dh(this.e.privateKey, this.re!));
      this.step = 2;
      return Buffer.concat([this.e.publicKey, this.encryptAndHash(EMPTY)]);
    }
    throw new Error('Noise handshake: writeMessage called out of order');
  }

  /** Consume an incoming handshake message; returns its (empty) payload. */
  readMessage(message: Buffer): Buffer {
    if (message.length < DH_LEN + TAG_LEN) throw new Error('Noise handshake message too short');
    const remoteE = message.subarray(0, DH_LEN);
    const rest = message.subarray(DH_LEN);
    if (this.role === 'responder' && this.step === 0) {
      // -> psk, e
      this.mixKeyAndHash(this.psk);
      this.re = Buffer.from(remoteE);
      this.mixHash(this.re);
      this.mixKey(this.re);
      this.step = 1;
      return this.decryptAndHash(rest);
    }
    if (this.role === 'initiator' && this.step === 1) {
      // <- e, ee
      this.re = Buffer.from(remoteE);
      this.mixHash(this.re);
      this.mixKey(this.re);
      this.mixKey(dh(this.e.privateKey, this.re));
      this.step = 2;
      return this.decryptAndHash(rest);
    }
    throw new Error('Noise handshake: readMessage called out of order');
  }

  get isComplete(): boolean {
    return this.step === 2;
  }

  split(): { send: NoiseCipherState; receive: NoiseCipherState } {
    if (!this.isComplete) throw new Error('Noise handshake not complete');
    const [k1, k2] = hkdf(this.ck, EMPTY, 2);
    const c1 = new NoiseCipherState(k1.subarray(0, 32));
    const c2 = new NoiseCipherState(k2.subarray(0, 32));
    return this.role === 'initiator' ? { send: c1, receive: c2 } : { send: c2, receive: c1 };
  }

  private mixHash(data: Buffer): void {
    this.h = sha256(this.h, data);
  }

  private mixKey(ikm: Buffer): void {
    const [ck, tempK] = hkdf(this.ck, ikm, 2);
    this.ck = ck;
    this.k = tempK.subarray(0, 32);
    this.n = 0n;
  }

  private mixKeyAndHash(ikm: Buffer): void {
    const [ck, tempH, tempK] = hkdf(this.ck, ikm, 3);
    this.ck = ck;
    this.mixHash(tempH);
    this.k = tempK.subarray(0, 32);
    this.n = 0n;
  }

  private encryptAndHash(plaintext: Buffer): Buffer {
    if (!this.k) {
      this.mixHash(plaintext);
      return plaintext;
    }
    const ciphertext = aeadEncrypt(this.k, this.n, this.h, plaintext);
    this.n += 1n;
    this.mixHash(ciphertext);
    return ciphertext;
  }

  private decryptAndHash(ciphertext: Buffer): Buffer {
    if (!this.k) {
      this.mixHash(ciphertext);
      return ciphertext;
    }
    const plaintext = aeadDecrypt(this.k, this.n, this.h, ciphertext);
    this.n += 1n;
    this.mixHash(ciphertext);
    return plaintext;
  }
}

/** Validate and decode an ESPHome API encryption key (base64, 32 bytes). */
export const decodeNoisePsk = (key: string): Buffer | null => {
  const trimmed = key.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const bytes = Buffer.from(trimmed, 'base64');
  return bytes.length === 32 ? bytes : null;
};
