import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils';

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
}) as unknown as SqlDriverAdapterFactory;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Prisma singleton — survives Next.js hot reloads in dev.
 * Uses the libSQL adapter (Prisma 7+ pattern).
 */
export const prisma =
  global.__prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
