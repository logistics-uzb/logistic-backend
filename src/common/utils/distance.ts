import { getRegionByIndexedName } from '@/common/helpers/region-coords';

/** Yo'lda mashina to'g'ri chiziq bo'yicha yurmaydi — realroq masofa uchun 1.30 koeffitsient. */
const ROAD_FACTOR = 1.3;

/** O'rtacha yuk mashinasi tezligi (km/soat) — vaqt hisoblash uchun. */
const AVERAGE_SPEED_KM_H = 55;

/** Yer radiusi (km) — Haversine formulasi uchun. */
const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Minutlarni "H soat M min" ko'rinishida formatlaydi.
 */
export function formatMinutes(totalMinutes: number): string {
  const roundedMinutes = Math.round(totalMinutes);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} soat`;
  return `${hours} soat ${minutes} min`;
}

export interface DistanceResult {
  /** To'g'ri chiziq bo'yicha (Haversine) masofa, km. */
  directDistanceKm: number;
  /** Yol koeffitsienti bilan tuzatilgan masofa, km. */
  distanceKm: number;
  /** O'rtacha tezlik bo'yicha vaqt, minut. */
  timeMinutes: number;
  /** Vaqt inson uchun tayyor matnda ("6 soat 45 min"). */
  formattedTime: string;
}

/**
 * Haversine formulasi bilan ikki nuqta orasidagi masofa.
 * Kirish: koordinatalar. Chiqish: masofa + vaqt.
 */
export function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): DistanceResult {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const directResult = EARTH_RADIUS_KM * c;
  const distanceKm = directResult * ROAD_FACTOR;
  const timeMinutes = (distanceKm / AVERAGE_SPEED_KM_H) * 60;

  return {
    directDistanceKm: directResult,
    distanceKm,
    timeMinutes,
    formattedTime: formatMinutes(timeMinutes),
  };
}

/**
 * Ikkala regionni ham `region-coords` dan qidiradi va masofani qaytaradi.
 * Qo'llab-quvvatlanadigan mamlakatlar: O'zb, Qozog'iston, Qirg'iziston,
 * Tojikiston, Belarus, Turkiya. Bo'lmagan yo'nalishlar uchun → null.
 */
export function getRouteDistance(
  fromIndexedName: string | null | undefined,
  toIndexedName: string | null | undefined
): DistanceResult | null {
  const from = getRegionByIndexedName(fromIndexedName);
  const to = getRegionByIndexedName(toIndexedName);
  if (!from || !to) return null;
  return getDistanceKm(from.coor.lat, from.coor.lng, to.coor.lat, to.coor.lng);
}

export interface PricePerKm {
  /** paymentAmount / distanceKm — bir km uchun narx. */
  value: number;
  /** Valyuta (kirish paymentCurrency ni takrorlaydi). */
  currency: string;
}

/**
 * Bir km uchun narxni hisoblaydi. `paymentAmount`, `distanceKm` va `paymentCurrency`
 * uchtasi ham mavjud (va distanceKm > 0) bo'lgandagina hisoblab beriladi.
 * Aks holda → null.
 */
export function getPricePerKm(
  paymentAmount: number | null | undefined,
  distanceKm: number | null | undefined,
  paymentCurrency: string | null | undefined
): PricePerKm | null {
  if (paymentAmount == null || distanceKm == null || !paymentCurrency) {
    return null;
  }
  if (!Number.isFinite(paymentAmount) || !Number.isFinite(distanceKm)) {
    return null;
  }
  if (distanceKm <= 0) return null;
  return {
    value: paymentAmount / distanceKm,
    currency: paymentCurrency,
  };
}
