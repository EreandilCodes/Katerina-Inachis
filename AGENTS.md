# AGENTS.md — Inachis

## Produkční data jsou nedotknutelná

- Production DB (SQLite `/data/inachis.db` nebo PostgreSQL) **nikdy nebyla smazána, resetována ani přepsána**.
- Railway Volume `/data` (který obsahuje `inachis.db` a `uploads/gallery/`) **nikdy nebyl odstraněn**.
- Žádný `DROP`/`TRUNCATE`/`DELETE` na produkčních datech.

## SQLite → PostgreSQL migrace

- Migrace je **additive a idempotentní** (číta z kopie SQLite, píše do čistého PG; `ON CONFLICT (id) DO UPDATE`).
- Nejprve se ověří skutečný `DB_PROVIDER`/`DATABASE_URL` a existence PG databáze.
- Existující SQLite data se kopírují s zachováním ID; sekvence se resetují na `MAX(id)`.
- Před přepnutím `DB_PROVIDER=postgres` se migrace ověří (počty záznamů).
- `pg` musí být v závislostech **před** tím, než se `DB_PROVIDER=postgres` zapne (jinak aplikace spadne).

## Bezpečnost při změnách

- Žádný deploy s neověřenou změnou DB.
- Než přepnete provider, proveďte audit a zmapujte stav.
- Nikdy nevypisujte `DATABASE_URL`, `RESEND_API_KEY`, hesla, tokeny.
- Necommitujte `.env`, SQLite DB, uploadované soubory.

## DB provider selection

- `DB_PROVIDER=sqlite` (default) → lokální SQLite (`SQLITE_PATH` nebo `backend/inachis.db`).
- `DB_PROVIDER=postgres` → PostgreSQL (`DATABASE_URL`).
- `initDatabase()` je bezpečný (`CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`).

## Galerie / uploads

- `GALLERY_UPLOAD_DIR` persistentní (Railway volume `/data/uploads/gallery`).
- Obrázky jsou uploadována přes sharp optimalizaci; cesty v DB nebo v obraze se nemění migrací.
