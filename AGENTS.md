# AGENTS.md — Inachis

## Dual-database architektura (záměrné rozhodnutí)

- **LOCAL = SQLite** (rychlý vývoj, testování; default `DB_PROVIDER=sqlite`).
- **PRODUCTION = PostgreSQL** (Railway service `Postgres`, `DATABASE_URL` sdílený do app service).
- **Produkce nesmí fallbackovat na SQLite.** `backend/database.js` obsahuje fail-fast guard:
  - `DB_PROVIDER=postgres` bez `DATABASE_URL` → aplikace se nespustí (exit 1).
  - Produkční runtime (`NODE_ENV=production` nebo `RAILWAY_ENVIRONMENT_NAME=production`) bez `DB_PROVIDER=postgres` → aplikace se nespustí (exit 1).
  - Tento guard **nikdy neslibovat**: „dočasně vypnout“, „obejít“, „ztlumit“. Je to ochrana proti tichému bootu prázdné SQLite DB v produkci.
- Startup log musí vždy jednoznačně uvádět `Database mode: PostgreSQL|SQLite`.

## Produkční data jsou nedotknutelná

- Produkční data žijí v **PostgreSQL** (`postgres.railway.internal`, db `railway`) od 2026-09-26.
- Railway Volume `/data` zůstává **nedotčený** (obsahuje `inachis.db` a `uploads/gallery/`) — je to historický snapshot SQLite, slouží jako záloha; nikdy nesmazat bez explicitního rozhodnutí.
- Galerie soubory: `GALLERY_UPLOAD_DIR=/data/uploads/gallery` — volume musí zůstat mountnutý i po přechodu na PG (obrázky nejsou v PG).
- Žádný `DROP`/`TRUNCATE`/`DELETE`/reset na produkčních datech.
- Deploy = nový container → nové připojení ke **stejné PostgreSQL**; data přežijí deploy (nezávislá na filesystemu kontejneru).

## SQLite → PostgreSQL migrace

- Migrace (`backend/migrate-sqlite-to-postgres.js`) je **additive a idempotentní**:
  - čte z **kopie** SQLite (nikdy nezamyká produkční soubor; default `/data/inachis.db`, testovatelné přes `MIGRATION_SQLITE_SRC`),
  - píše `ON CONFLICT (id|key) DO UPDATE` (`settings` je keyed by `key`, ne `id`),
  - sekvence se setvalují na **high-water mark ze `sqlite_sequence`** (AUTOINCREMENT nikdy nerecykluje id; `MAX(id)` může být po mazání nižší),
  - CREATE TABLE přidává `IF NOT EXISTS`, opakovaný běh je bezpečný,
  - verification porovnává počty i sekvence (PG numerics přicházejí jako string — porovnávat čísla).
- Migrace byla spuštěna a ověřena (2026-09-26): všechny tabulky OK, id zachována, sekvence pokračují správně.
- `pg` musí být v závislostech **před** tím, než se `DB_PROVIDER=postgres` zapne (jinak aplikace spadne).

## Bezpečnost při změnách

- Žádný deploy s neověřenou změnou DB.
- Než přepnete provider, proveďte audit a zmapujte stav.
- Nikdy nevypisujte `DATABASE_URL`, `RESEND_API_KEY`, hesla, tokeny (v logu ani v reportu).
- Necommitujte `.env`, SQLite DB, uploadované soubory.

## DB provider selection

- `DB_PROVIDER=sqlite` (default) → lokální SQLite (`SQLITE_PATH` nebo `backend/inachis.db`).
- `DB_PROVIDER=postgres` → PostgreSQL (`DATABASE_URL`, SSL v produkci auto).
- `initDatabase()` je idempotentní a nedestruktivní (`CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, additivní `ALTER TABLE`); nikdy ne­maže ani nepřepisuje uživatelská data, seedy jen doplňují chybějící.
- PG wrapper přidává `RETURNING id` k INSERTům — **výjimka: `settings`** (PK je `key`); nesmí se appendovat `RETURNING id` na tabulky bez `id` sloupce.

## Testování

- 13 e2e sadí (`npm run test:*`) běží lokálně proti SQLite — spouštět po každé DB/API/UI změně.
- PG režim lze testovat lokálně: `DATABASE_URL=... DB_PROVIDER=postgres PORT=3005 node backend/server.js`.
- Testy vyžadují chromium: `INACHIS_TEST_CHROME=<path>` + případné chybějící systémové knihovny přes `LD_LIBRARY_PATH`.

## Galerie / uploads

- `GALLERY_UPLOAD_DIR` persistentní (Railway volume `/data/uploads/gallery`).
- Obrázky jsou uploadovány přes sharp optimalizaci; cesty v DB nebo v obraze se nemění migrací.
- Thumbnaily (`/img/gallery`) se ukládají do `/data/thumbs-cache` na stejném volume.