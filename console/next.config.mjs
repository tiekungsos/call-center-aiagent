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
  // console ภายใน — สั่ง search engine/bot ไม่ให้จัดทำดัชนี (คู่กับ app/robots.ts)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
