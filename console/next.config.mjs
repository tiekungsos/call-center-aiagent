import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // กัน warning "multiple lockfiles" — repo นี้มี package-lock ของ bridge อยู่ข้างบน
  turbopack: { root },
  // console เรียก API ผ่าน proxy /api (ดู app/api/[...path]/route.ts) จึงไม่ต้องมี NEXT_PUBLIC_API_URL
  env: {
    NEXT_PUBLIC_TENANT: process.env.NEXT_PUBLIC_TENANT ?? process.env.TENANT_SLUG ?? 'aileo',
  },
};
