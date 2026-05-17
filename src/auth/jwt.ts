/**
 * JWT utilities — sign and verify tokens.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuthenticationError } from '../utils/errors.js';
import type { JwtPayload } from '../types/index.js';

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss'>): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    algorithm: 'HS256',
  });
}

export function verifyJwt(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      algorithms: ['HS256'],
    }) as JwtPayload;
  } catch (err) {
    const msg = err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token';
    throw new AuthenticationError(msg);
  }
}

export function decodeJwt(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') return null;
  return decoded as JwtPayload;
}
