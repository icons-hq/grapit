import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { prepareJwtVerificationKey } from './jwt-verification-key.js';

describe('prepared JWT verification key', () => {
  const secret = 'synthetic-verification-key';
  it.each(['HS256', 'HS384', 'HS512'] as const)('preserves %s verification and expiry checks', (algorithm) => {
    const jwt = new JwtService();
    const verifier = new JwtService({ secret: prepareJwtVerificationKey(secret) });
    const token = jwt.sign({ sub: 'synthetic-buyer', iat: 1000 }, { secret, algorithm, expiresIn: 60 });
    expect(verifier.verify(token, { clockTimestamp: 1059 })).toMatchObject({ sub: 'synthetic-buyer' });
    expect(() => verifier.verify(token, { clockTimestamp: 1060 })).toThrow();
    const wrong = new JwtService({ secret: prepareJwtVerificationKey('wrong-key') });
    expect(() => wrong.verify(token, { clockTimestamp: 1059 })).toThrow();
  });

  it('keeps the existing PEM-public-key interpretation', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const jwt = new JwtService({ privateKey });
    const token = jwt.sign({ sub: 'buyer' }, { algorithm: 'RS256' });
    const verifier = new JwtService({ secret: prepareJwtVerificationKey(pem) });
    expect(verifier.verify(token)).toMatchObject({ sub: 'buyer' });
    expect(() => prepareJwtVerificationKey('')).toThrow();
  });
});
