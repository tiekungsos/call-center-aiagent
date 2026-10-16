/**
 * เสียงของโมเดล Gemini Live — ใช้เป็นตัวเลือกในหน้า /agents
 * name = ค่าที่ส่งให้โมเดล (ต้องตรงเป๊ะ) · gender ตามเอกสาร Google (Firebase AI Logic / Live API)
 * (หญิง 14 เสียง · ชาย 16 เสียง)
 */
export type Gender = 'male' | 'female';

export interface Voice {
  name: string;
  tone: string;
  pitch: string;
  gender: Gender;
}

export const VOICES: Voice[] = [
  { name: 'Zephyr', tone: 'สดใส', pitch: 'เสียงสูง', gender: 'female' },
  { name: 'Kore', tone: 'มั่นคง', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Aoede', tone: 'ผ่อนคลาย', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Callirrhoe', tone: 'สบาย ๆ', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Autonoe', tone: 'สดใส', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Leda', tone: 'อ่อนเยาว์', pitch: 'เสียงสูง', gender: 'female' },
  { name: 'Despina', tone: 'นุ่มนวล', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Erinome', tone: 'ชัดเจน', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Laomedeia', tone: 'คึกคัก', pitch: 'เสียงสูง', gender: 'female' },
  { name: 'Achernar', tone: 'นุ่ม', pitch: 'เสียงต่ำ', gender: 'female' },
  { name: 'Gacrux', tone: 'เป็นผู้ใหญ่', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Pulcherrima', tone: 'ตรงไปตรงมา', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Vindemiatrix', tone: 'อ่อนโยน', pitch: 'เสียงกลาง', gender: 'female' },
  { name: 'Sulafat', tone: 'อบอุ่น', pitch: 'เสียงกลาง', gender: 'female' },

  { name: 'Puck', tone: 'คึกคัก', pitch: 'เสียงกลาง', gender: 'male' },
  { name: 'Charon', tone: 'ให้ข้อมูล', pitch: 'เสียงต่ำ', gender: 'male' },
  { name: 'Fenrir', tone: 'ตื่นเต้น', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Orus', tone: 'มั่นคง', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Enceladus', tone: 'นุ่มมีลมหายใจ', pitch: 'เสียงต่ำ', gender: 'male' },
  { name: 'Iapetus', tone: 'ชัดเจน', pitch: 'เสียงต่ำ', gender: 'male' },
  { name: 'Umbriel', tone: 'สบาย ๆ', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Algieba', tone: 'นุ่มนวล', pitch: 'เสียงต่ำ', gender: 'male' },
  { name: 'Algenib', tone: 'ห้าว', pitch: 'เสียงต่ำ', gender: 'male' },
  { name: 'Rasalgethi', tone: 'ให้ข้อมูล', pitch: 'เสียงกลาง', gender: 'male' },
  { name: 'Alnilam', tone: 'มั่นคง', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Schedar', tone: 'เรียบ', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Achird', tone: 'เป็นมิตร', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Zubenelgenubi', tone: 'ลำลอง', pitch: 'เสียงกลาง-ต่ำ', gender: 'male' },
  { name: 'Sadachbia', tone: 'มีชีวิตชีวา', pitch: 'เสียงต่ำ', gender: 'male' },
  { name: 'Sadaltager', tone: 'รอบรู้', pitch: 'เสียงกลาง', gender: 'male' },
];

export const GENDER_LABEL: Record<Gender, string> = { female: 'หญิง', male: 'ชาย' };

export const voicesOf = (gender: Gender) => VOICES.filter((v) => v.gender === gender);

export const voiceGender = (name: string): Gender | undefined => VOICES.find((v) => v.name === name)?.gender;

export const voiceLabel = (name: string): string => {
  const v = VOICES.find((x) => x.name === name);
  return v ? `${v.name} — ${v.tone}, ${v.pitch}` : name;
};

/** ตัวอย่างเสียงจาก AI Studio — ใช้ชื่อเสียงตามด้วย .wav (ทดสอบแล้วว่ามีครบทั้ง 30 เสียง) */
export const voiceSampleUrl = (name: string) => `https://www.gstatic.com/aistudio/voices/samples/${name}.wav`;

/** ชื่อเสียงนี้เป็นเสียงที่ระบบรู้จักไหม (ไม่รู้จัก = ไม่มีตัวอย่างให้ฟัง) */
export const isKnownVoice = (name: string) => VOICES.some((v) => v.name === name);
