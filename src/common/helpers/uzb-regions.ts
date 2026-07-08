/**
 * O'zbekiston viloyat va shaharlarning koordinatalari (lat/lng).
 * `indexedName` route-data.ts dagi region indexedName bilan bir xil bo'lishi shart —
 * shu asosda LogisticMessage.regionFrom/regionTo bo'yicha masofa hisoblanadi.
 *
 * Faqat O'zbekiston ichidagi yo'nalishlar uchun masofa xizmati bor. Boshqa
 * mamlakatlarga yo'nalishlarni hisoblash uchun bu ro'yxat yetarli emas.
 */
export interface UzbRegion {
  id: number;
  name: string;
  indexedName: string;
  coor: { lat: number; lng: number };
}

export const uzbRegions: UzbRegion[] = [
  {
    id: 1,
    name: 'Toshkent shahri',
    indexedName: 'tashkent_city',
    coor: { lat: 41.311151, lng: 69.279737 },
  },
  {
    id: 2,
    name: 'Toshkent viloyati',
    indexedName: 'tashkent_region',
    coor: { lat: 41.041029, lng: 69.35842 },
  },
  {
    id: 3,
    name: 'Andijon viloyati',
    indexedName: 'andijan',
    coor: { lat: 40.78339, lng: 72.350664 },
  },
  {
    id: 4,
    name: "Farg'ona viloyati",
    indexedName: 'ferghana',
    coor: { lat: 40.389448, lng: 71.783135 },
  },
  {
    id: 5,
    name: 'Namangan viloyati',
    indexedName: 'namangan',
    coor: { lat: 41.000078, lng: 71.67257 },
  },
  {
    id: 6,
    name: 'Sirdaryo viloyati',
    indexedName: 'syrdarya',
    coor: { lat: 40.509489, lng: 68.769089 },
  },
  {
    id: 7,
    name: 'Jizzax viloyati',
    indexedName: 'jizzakh',
    coor: { lat: 40.120302, lng: 67.828544 },
  },
  {
    id: 8,
    name: 'Samarqand viloyati',
    indexedName: 'samarkand',
    coor: { lat: 39.654406, lng: 66.975827 },
  },
  {
    id: 9,
    name: 'Buxoro viloyati',
    indexedName: 'bukhara',
    coor: { lat: 39.767968, lng: 64.421725 },
  },
  {
    id: 10,
    name: 'Navoiy viloyati',
    indexedName: 'navoi',
    coor: { lat: 40.102541, lng: 65.37441 },
  },
  {
    id: 11,
    name: 'Qashqadaryo viloyati',
    indexedName: 'kashkadarya',
    coor: { lat: 38.841605, lng: 65.789979 },
  },
  {
    id: 12,
    name: 'Surxondaryo viloyati',
    indexedName: 'surkhandarya',
    coor: { lat: 37.228581, lng: 67.275451 },
  },
  {
    id: 13,
    name: 'Xorazm viloyati',
    indexedName: 'khorezm',
    coor: { lat: 41.550458, lng: 60.631476 },
  },
  {
    id: 14,
    name: "Qoraqalpog'iston Respublikasi",
    indexedName: 'karakalpakstan',
    coor: { lat: 42.460334, lng: 59.617987 },
  },
];

/** indexedName bo'yicha O'zb viloyatini topish (bo'lmasa undefined). */
export function getUzbRegionByIndexedName(
  indexedName: string | null | undefined
): UzbRegion | undefined {
  if (!indexedName) return undefined;
  return uzbRegions.find((r) => r.indexedName === indexedName);
}
