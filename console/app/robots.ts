import type { MetadataRoute } from 'next';

/** console เป็นระบบภายใน — ห้าม crawler จัดทำดัชนีทุกเส้นทาง */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
