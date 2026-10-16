'use client';

import { useRouter } from 'next/navigation';

/**
 * แถวรายการที่กดได้ทั้งแถว — คลิกตรงไหนก็เปิดรายละเอียด (ยังมีลิงก์จริงในช่องเวลาเพื่อ accessibility)
 * ปุ่ม/ลิงก์ที่อยู่ข้างในต้องเรียก stopPropagation เองถ้าไม่ต้องการให้เปลี่ยนหน้า
 */
export function CallRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr className="row-link" onClick={() => router.push(href)}>
      {children}
    </tr>
  );
}
