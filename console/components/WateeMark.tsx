/** ตราสัญลักษณ์วาที (chat bubble + หูโทรศัพท์) — ใช้ id เดียวได้ เพราะ 1 หน้าแสดงครั้งเดียว */
export function WateeMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} fill="none" role="img" aria-label="วาที">
      <defs>
        <linearGradient id="watee-grad" x1="8" y1="125" x2="111" y2="9" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6B40FF" />
          <stop offset=".51" stopColor="#315CFF" />
          <stop offset="1" stopColor="#46A8FF" />
        </linearGradient>
      </defs>
      <path
        d="M35 35C42 17 59 13 79 13h11c18 0 29 13 29 31v29c0 18-12 30-31 30H64l-14 11v-20"
        stroke="url(#watee-grad)"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M32 57C20 54 12 60 10 70c-2 12 17 35 28 42 10 7 18 4 23-4 3-5 1-10-3-14l-8-7c-4-3-9-3-14 0-5-6-10-12-12-18 7-5 8-10 8-12Z"
        fill="url(#watee-grad)"
      />
      <path d="M65 53v12M91 53v12" stroke="#101538" strokeWidth="7" strokeLinecap="round" />
      <path d="M71 77c5 7 12 7 17 0" stroke="#101538" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
