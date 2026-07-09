/**
 * Ma'lum viloyat/shaharlarning koordinatalari (lat/lng) — masofa hisoblash uchun.
 *
 * `indexedName` maydonlari `route-data.ts` dagi region indexedName bilan aynan
 * bir xil bo'lishi shart — shu asosda `LogisticMessage.regionFrom/regionTo`
 * bo'yicha masofa aniqlanadi.
 *
 * Qo'llab-quvvatlanadigan mamlakatlar:
 *   - O'zbekiston  (14 viloyat/shahar)
 *   - Qozog'iston  (10 shahar/viloyat)
 *   - Qirg'iziston (9)
 *   - Tojikiston   (4)
 *   - Belarus      (7)
 *   - Turkiya      (8 shahar)
 *
 * Boshqa mamlakatlar (Rossiya, Xitoy, Yevropa) uchun koordinatalar hozircha yo'q —
 * bunday yo'nalishlar uchun masofa `null` bo'ladi.
 */

export interface RegionCoords {
  id: number;
  name: string;
  indexedName: string;
  coor: { lat: number; lng: number };
}

// ── O'zbekiston ─────────────────────────────────────────────────────────────
export const uzbRegions: RegionCoords[] = [
  { id: 1, name: 'Toshkent shahri', indexedName: 'tashkent_city', coor: { lat: 41.311151, lng: 69.279737 } },
  { id: 2, name: 'Toshkent viloyati', indexedName: 'tashkent_region', coor: { lat: 41.041029, lng: 69.35842 } },
  { id: 3, name: 'Andijon viloyati', indexedName: 'andijan', coor: { lat: 40.78339, lng: 72.350664 } },
  { id: 4, name: "Farg'ona viloyati", indexedName: 'ferghana', coor: { lat: 40.389448, lng: 71.783135 } },
  { id: 5, name: 'Namangan viloyati', indexedName: 'namangan', coor: { lat: 41.000078, lng: 71.67257 } },
  { id: 6, name: 'Sirdaryo viloyati', indexedName: 'syrdarya', coor: { lat: 40.509489, lng: 68.769089 } },
  { id: 7, name: 'Jizzax viloyati', indexedName: 'jizzakh', coor: { lat: 40.120302, lng: 67.828544 } },
  { id: 8, name: 'Samarqand viloyati', indexedName: 'samarkand', coor: { lat: 39.654406, lng: 66.975827 } },
  { id: 9, name: 'Buxoro viloyati', indexedName: 'bukhara', coor: { lat: 39.767968, lng: 64.421725 } },
  { id: 10, name: 'Navoiy viloyati', indexedName: 'navoi', coor: { lat: 40.102541, lng: 65.37441 } },
  { id: 11, name: 'Qashqadaryo viloyati', indexedName: 'kashkadarya', coor: { lat: 38.841605, lng: 65.789979 } },
  { id: 12, name: 'Surxondaryo viloyati', indexedName: 'surkhandarya', coor: { lat: 37.228581, lng: 67.275451 } },
  { id: 13, name: 'Xorazm viloyati', indexedName: 'khorezm', coor: { lat: 41.550458, lng: 60.631476 } },
  { id: 14, name: "Qoraqalpog'iston Respublikasi", indexedName: 'karakalpakstan', coor: { lat: 42.460334, lng: 59.617987 } },
];

// ── Qozog'iston ─────────────────────────────────────────────────────────────
export const kazRegions: RegionCoords[] = [
  { id: 1, name: 'Olmaota', indexedName: 'almaty', coor: { lat: 43.237163, lng: 76.945645 } },
  { id: 2, name: 'Ostona', indexedName: 'astana', coor: { lat: 51.128201, lng: 71.430429 } },
  { id: 3, name: 'Chimkent', indexedName: 'shymkent', coor: { lat: 42.368009, lng: 69.612769 } },
  { id: 4, name: 'Aktau', indexedName: 'aktau', coor: { lat: 43.635588, lng: 51.168245 } },
  { id: 5, name: 'Atirau', indexedName: 'atyrau', coor: { lat: 47.106799, lng: 51.916874 } },
  { id: 6, name: "Aqto'be", indexedName: 'aktobe', coor: { lat: 50.300377, lng: 57.154555 } },
  { id: 7, name: "Qarag'anda", indexedName: 'karaganda', coor: { lat: 49.80776, lng: 73.088504 } },
  { id: 8, name: 'Taraz', indexedName: 'taraz', coor: { lat: 42.899664, lng: 71.392727 } },
  { id: 9, name: "Qizilo'rda", indexedName: 'kyzylorda', coor: { lat: 44.842544, lng: 65.502563 } },
  { id: 10, name: 'Pavlodar', indexedName: 'pavlodar', coor: { lat: 52.285588, lng: 76.941081 } },
];

// ── Qirg'iziston ────────────────────────────────────────────────────────────
export const kyrRegions: RegionCoords[] = [
  { id: 1, name: 'Bishkek shahri', indexedName: 'bishkek', coor: { lat: 42.875969, lng: 74.603701 } },
  { id: 2, name: "O'sh shahri", indexedName: 'osh_city', coor: { lat: 40.517525, lng: 72.80557 } },
  { id: 3, name: 'Chuy viloyati', indexedName: 'chuy', coor: { lat: 42.837485, lng: 75.295116 } },
  { id: 4, name: "O'sh viloyati", indexedName: 'osh_region', coor: { lat: 40.517526, lng: 72.805575 } },
  { id: 5, name: 'Jalolobod viloyati', indexedName: 'jalal-abad', coor: { lat: 40.938049, lng: 72.993309 } },
  { id: 6, name: "Issiqko'l viloyati", indexedName: 'issyk-kul', coor: { lat: 42.491147, lng: 78.399567 } },
  { id: 7, name: 'Norin viloyati', indexedName: 'naryn', coor: { lat: 41.42833, lng: 75.997635 } },
  { id: 8, name: 'Botken viloyati', indexedName: 'batken', coor: { lat: 40.060518, lng: 70.819629 } },
  { id: 9, name: 'Talas viloyati', indexedName: 'talas', coor: { lat: 42.520755, lng: 72.250591 } },
];

// ── Tojikiston ──────────────────────────────────────────────────────────────
export const tajRegions: RegionCoords[] = [
  { id: 1, name: 'Dushanbe', indexedName: 'dushanbe', coor: { lat: 38.576271, lng: 68.779716 } },
  { id: 2, name: "Sug'd viloyati", indexedName: 'sughd', coor: { lat: 40.278954, lng: 69.631677 } },
  { id: 3, name: 'Xatlon viloyati', indexedName: 'khatlon', coor: { lat: 37.838365, lng: 68.779393 } },
  { id: 4, name: "Tog'li-Badaxshon", indexedName: 'badakhshan', coor: { lat: 36.815216, lng: 70.865964 } },
];

// ── Belarus ─────────────────────────────────────────────────────────────────
export const blrRegions: RegionCoords[] = [
  { id: 1, name: 'Minsk shahri', indexedName: 'minsk_city', coor: { lat: 53.902284, lng: 27.561831 } },
  { id: 2, name: 'Minsk viloyati', indexedName: 'minsk_region', coor: { lat: 53.902735, lng: 27.555691 } },
  { id: 3, name: 'Brest viloyati', indexedName: 'brest', coor: { lat: 52.093754, lng: 23.685107 } },
  { id: 4, name: 'Vitebsk viloyati', indexedName: 'vitebsk', coor: { lat: 55.184217, lng: 30.202878 } },
  { id: 5, name: 'Gomel viloyati', indexedName: 'gomel', coor: { lat: 52.42416, lng: 31.014281 } },
  { id: 6, name: 'Grodno viloyati', indexedName: 'grodno', coor: { lat: 53.677839, lng: 23.829529 } },
  { id: 7, name: 'Mogilev viloyati', indexedName: 'mogilev', coor: { lat: 53.894548, lng: 30.330654 } },
];

// ── Turkiya ─────────────────────────────────────────────────────────────────
export const turRegions: RegionCoords[] = [
  { id: 1, name: 'Ankara', indexedName: 'ankara', coor: { lat: 39.920763, lng: 32.854049 } },
  { id: 2, name: 'Istanbul', indexedName: 'istanbul', coor: { lat: 41.011218, lng: 28.978178 } },
  { id: 3, name: 'Izmir', indexedName: 'izmir', coor: { lat: 38.429048, lng: 27.134206 } },
  { id: 4, name: 'Antalya', indexedName: 'antalya', coor: { lat: 36.887121, lng: 30.703258 } },
  { id: 5, name: 'Bursa', indexedName: 'bursa', coor: { lat: 40.18859, lng: 29.060814 } },
  { id: 6, name: 'Adana', indexedName: 'adana', coor: { lat: 37.002955, lng: 35.319457 } },
  { id: 7, name: 'Gaziantep', indexedName: 'gaziantep', coor: { lat: 37.062688, lng: 37.37951 } },
  { id: 8, name: 'Konya', indexedName: 'konya', coor: { lat: 37.874903, lng: 32.492127 } },
];

// ── Barcha regionlar birlashtirilgan ────────────────────────────────────────
// Bitta ro'yxatda O(N) qidiruv o'rniga Map bilan O(1) qilamiz.
const _allRegionsList: RegionCoords[] = [
  ...uzbRegions,
  ...kazRegions,
  ...kyrRegions,
  ...tajRegions,
  ...blrRegions,
  ...turRegions,
];

const _regionByIndexedName = new Map<string, RegionCoords>();
for (const r of _allRegionsList) {
  _regionByIndexedName.set(r.indexedName, r);
}

/** indexedName bo'yicha regionni topish (bo'lmasa undefined). Case-sensitive. */
export function getRegionByIndexedName(
  indexedName: string | null | undefined
): RegionCoords | undefined {
  if (!indexedName) return undefined;
  return _regionByIndexedName.get(indexedName);
}
