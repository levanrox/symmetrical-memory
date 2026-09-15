import crypto from 'crypto';

/**
 * Hashes a plaintext password using crypto.scrypt with a salt.
 * Returns format: `${salt}:${derivedKeyHex}`
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verifies a plaintext password against a stored hash formatted as `${salt}:${derivedKeyHex}`.
 */
export async function verifyPassword(password: string, combinedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = combinedHash.split(':');
    if (parts.length !== 2) {
      return resolve(false);
    }
    const [salt, keyHex] = parts;
    const key = Buffer.from(keyHex, 'hex');

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      try {
        const match = crypto.timingSafeEqual(key, derivedKey);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}
