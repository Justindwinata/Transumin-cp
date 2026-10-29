import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/** FR-014: machine-readable auth error envelope; never leaks credential material. */
export function authError(code: string, status: number): HttpException {
  return new HttpException(
    { error: { code, message: code, request_id: randomUUID() } },
    status,
  );
}
