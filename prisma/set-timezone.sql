-- DB darajasida standart timezone'ni Asia/Tashkent (UTC+5) qilib belgilash.
-- Bu barcha yangi sessiyalar uchun qo'llaniladi. Storage o'zgarmaydi — timestamptz
-- ustunlar hali ham UTC saqlanadi (standart), lekin SQL funksiyalar
-- (now(), date_trunc, INTERVAL) Toshkent vaqtida ishlaydi.
--
-- Ishga tushirish:
--   npx prisma db execute --file ./prisma/set-timezone.sql --schema ./prisma/schema.prisma
--
-- Bir marta ishga tushirilsa yetarli — o'zgarish DB'da doimiy qoladi.

ALTER DATABASE logistic_db SET TIMEZONE TO 'Asia/Tashkent';
