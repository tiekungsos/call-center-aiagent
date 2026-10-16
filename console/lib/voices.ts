/**
 * เสียงของโมเดล Gemini Live — ใช้เป็นตัวเลือกในหน้า /agents
 * name = ค่าที่ส่งให้โมเดล (ต้องตรงเป๊ะ), ที่เหลือเป็นคำอธิบายให้ผู้ดูแลเลือก
 */
export interface Voice {
  name: string;
  tone: string;
  pitch: string;
}

export const VOICES: Voice[] = [
  { name: 'Zephyr', tone: 'สดใส', pitch: 'เสียงสูง' },
  { name: 'Puck', tone: 'คึกคัก', pitch: 'เสียงกลาง' },
  { name: 'Charon', tone: 'ให้ข้อมูล', pitch: 'เสียงต่ำ' },
  { name: 'Kore', tone: 'มั่นคง', pitch: 'เสียงกลาง' },
  { name: 'Fenrir', tone: 'ตื่นเต้น', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Leda', tone: 'อ่อนเยาว์', pitch: 'เสียงสูง' },
  { name: 'Orus', tone: 'มั่นคง', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Aoede', tone: 'ผ่อนคลาย', pitch: 'เสียงกลาง' },
  { name: 'Callirrhoe', tone: 'สบาย ๆ', pitch: 'เสียงกลาง' },
  { name: 'Autonoe', tone: 'สดใส', pitch: 'เสียงกลาง' },
  { name: 'Enceladus', tone: 'นุ่มมีลมหายใจ', pitch: 'เสียงต่ำ' },
  { name: 'Iapetus', tone: 'ชัดเจน', pitch: 'เสียงต่ำ' },
  { name: 'Umbriel', tone: 'สบาย ๆ', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Algieba', tone: 'นุ่มนวล', pitch: 'เสียงต่ำ' },
  { name: 'Despina', tone: 'นุ่มนวล', pitch: 'เสียงกลาง' },
  { name: 'Erinome', tone: 'ชัดเจน', pitch: 'เสียงกลาง' },
  { name: 'Algenib', tone: 'ห้าว', pitch: 'เสียงต่ำ' },
  { name: 'Rasalgethi', tone: 'ให้ข้อมูล', pitch: 'เสียงกลาง' },
  { name: 'Laomedeia', tone: 'คึกคัก', pitch: 'เสียงสูง' },
  { name: 'Achernar', tone: 'นุ่ม', pitch: 'เสียงต่ำ' },
  { name: 'Alnilam', tone: 'มั่นคง', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Schedar', tone: 'เรียบ', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Gacrux', tone: 'เป็นผู้ใหญ่', pitch: 'เสียงกลาง' },
  { name: 'Pulcherrima', tone: 'ตรงไปตรงมา', pitch: 'เสียงกลาง' },
  { name: 'Achird', tone: 'เป็นมิตร', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Zubenelgenubi', tone: 'ลำลอง', pitch: 'เสียงกลาง-ต่ำ' },
  { name: 'Vindemiatrix', tone: 'อ่อนโยน', pitch: 'เสียงกลาง' },
  { name: 'Sadachbia', tone: 'มีชีวิตชีวา', pitch: 'เสียงต่ำ' },
  { name: 'Sadaltager', tone: 'รอบรู้', pitch: 'เสียงกลาง' },
  { name: 'Sulafat', tone: 'อบอุ่น', pitch: 'เสียงกลาง' },
];

export const voiceLabel = (name: string): string => {
  const v = VOICES.find((x) => x.name === name);
  return v ? `${v.name} — ${v.tone}, ${v.pitch}` : name;
};
