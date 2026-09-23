/**
 * Official WKF kata list (number -> name), as per Appendix 1 of the WKF Kata
 * Competition Rules 2026.0.
 *
 * Athletes report their chosen kata BY NUMBER; when the number and the name
 * disagree, the number prevails (Art. 6.3, Appendix 1). Names are display-only
 * and carry the romanization variants the rulebook itself warns about
 * (Art. 5.1.2) — the number is the authoritative identifier.
 *
 * Spellings verified 2026-09-23 against the WKF Kata Competition Rules 2026.0
 * (Appendix 1) and the numbered WKF list published in the Basel Open Masters
 * 2026 bulletin (a WKF-sanctioned 2026 document); both agree on the 1-102
 * numbering.
 */

export interface KataEntry {
  number: number;
  name: string;
}

export const KATA_LIST: readonly KataEntry[] = [
  { number: 1, name: 'Anan' },
  { number: 2, name: 'Anan Dai' },
  { number: 3, name: 'Ananko' },
  { number: 4, name: 'Aoyagi' },
  { number: 5, name: 'Bassai' },
  { number: 6, name: 'Bassai Dai' },
  { number: 7, name: 'Bassai Sho' },
  { number: 8, name: 'Chatanyara Kushanku' },
  { number: 9, name: 'Chibana No Kushanku' },
  { number: 10, name: 'Chinte' },
  { number: 11, name: 'Chinto' },
  { number: 12, name: 'Enpi' },
  { number: 13, name: 'Fukyugata Ichi' },
  { number: 14, name: 'Fukyugata Ni' },
  { number: 15, name: 'Gankaku' },
  { number: 16, name: 'Garyu' },
  { number: 17, name: 'Gekisai (Geksai) 1' },
  { number: 18, name: 'Gekisai (Geksai) 2' },
  { number: 19, name: 'Gojushiho' },
  { number: 20, name: 'Gojushiho Dai' },
  { number: 21, name: 'Gojushiho Sho' },
  { number: 22, name: 'Hakucho' },
  { number: 23, name: 'Hangetsu' },
  { number: 24, name: 'Haufa (Haffa)' },
  { number: 25, name: 'Heian Shodan' },
  { number: 26, name: 'Heian Nidan' },
  { number: 27, name: 'Heian Sandan' },
  { number: 28, name: 'Heian Yondan' },
  { number: 29, name: 'Heian Godan' },
  { number: 30, name: 'Heiku' },
  { number: 31, name: 'Ishimine Bassai' },
  { number: 32, name: 'Itosu Rohai Shodan' },
  { number: 33, name: 'Itosu Rohai Nidan' },
  { number: 34, name: 'Itosu Rohai Sandan' },
  { number: 35, name: 'Jiin' },
  { number: 36, name: 'Jion' },
  { number: 37, name: 'Jitte' },
  { number: 38, name: 'Jyuroku' },
  { number: 39, name: 'Kanchin' },
  { number: 40, name: 'Kanku Dai' },
  { number: 41, name: 'Kanku Sho' },
  { number: 42, name: 'Kanshu' },
  { number: 43, name: 'Kishimoto No Kushanku' },
  { number: 44, name: 'Kousoukun' },
  { number: 45, name: 'Kousoukun Dai' },
  { number: 46, name: 'Kousoukun Sho' },
  { number: 47, name: 'Kururunfa' },
  { number: 48, name: 'Kusanku' },
  { number: 49, name: 'Kyan No Chinto' },
  { number: 50, name: 'Kyan No Wanshu' },
  { number: 51, name: 'Matsukaze' },
  { number: 52, name: 'Matsumura Bassai' },
  { number: 53, name: 'Matsumura Rohai' },
  { number: 54, name: 'Meikyo' },
  { number: 55, name: 'Myojo' },
  { number: 56, name: 'Naifanchin Shodan' },
  { number: 57, name: 'Naifanchin Nidan' },
  { number: 58, name: 'Naifanchin Sandan' },
  { number: 59, name: 'Naihanchin' },
  { number: 60, name: 'Nijushiho' },
  { number: 61, name: 'Nipaipo' },
  { number: 62, name: 'Niseishi' },
  { number: 63, name: 'Ohan' },
  { number: 64, name: 'Ohan Dai' },
  { number: 65, name: 'Oyadomari No Passai' },
  { number: 66, name: 'Pachu' },
  { number: 67, name: 'Paiku' },
  { number: 68, name: 'Papuren' },
  { number: 69, name: 'Passai' },
  { number: 70, name: 'Pinan Shodan' },
  { number: 71, name: 'Pinan Nidan' },
  { number: 72, name: 'Pinan Sandan' },
  { number: 73, name: 'Pinan Yondan' },
  { number: 74, name: 'Pinan Godan' },
  { number: 75, name: 'Rohai' },
  { number: 76, name: 'Saifa' },
  { number: 77, name: 'Sanchin' },
  { number: 78, name: 'Sansai' },
  { number: 79, name: 'Sanseiru' },
  { number: 80, name: 'Sanseru' },
  { number: 81, name: 'Seichin' },
  { number: 82, name: 'Seienchin (Seiyunchin)' },
  { number: 83, name: 'Seipai' },
  { number: 84, name: 'Seiryu' },
  { number: 85, name: 'Seishan' },
  { number: 86, name: 'Seisan (Sesan)' },
  { number: 87, name: 'Shiho Kousoukun' },
  { number: 88, name: 'Shinpa' },
  { number: 89, name: 'Shinsei' },
  { number: 90, name: 'Shisochin' },
  { number: 91, name: 'Sochin' },
  { number: 92, name: 'Suparinpei' },
  { number: 93, name: 'Tekki Shodan' },
  { number: 94, name: 'Tekki Nidan' },
  { number: 95, name: 'Tekki Sandan' },
  { number: 96, name: 'Tensho' },
  { number: 97, name: 'Tomari Bassai' },
  { number: 98, name: 'Unshu' },
  { number: 99, name: 'Unsu' },
  { number: 100, name: 'Useishi' },
  { number: 101, name: 'Wankan' },
  { number: 102, name: 'Wanshu' },
];

/** Number of kata on the official WKF list. */
export const KATA_COUNT = KATA_LIST.length;

const kataByNumber = new Map<number, string>(KATA_LIST.map((k) => [k.number, k.name]));

/** True when `n` is an integer in the official 1-102 range. */
export function isValidKataNumber(n: number): boolean {
  return Number.isInteger(n) && kataByNumber.has(n);
}

/** Display name for an official kata number, or undefined when not on the list. */
export function getKataName(number: number): string | undefined {
  return kataByNumber.get(number);
}
