-- ============================================================================
-- Frachtraten Dashboard — Supabase-Setup
-- Diesen kompletten Code im Supabase SQL Editor einfügen und einmal ausführen.
-- ============================================================================

-- Wird für gen_random_uuid() benötigt (bei Supabase i.d.R. schon aktiviert).
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Tabelle: freight_uploads — ein Eintrag pro hochgeladener Excel-Datei
-- ----------------------------------------------------------------------------
create table if not exists freight_uploads (
  id         uuid primary key default gen_random_uuid(),
  filename   text not null,
  month      text not null,              -- Format "YYYY-MM"
  added_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Tabelle: freight_entries — einzelne Frachtraten-Werte je Route/Spediteur/Größe
-- ----------------------------------------------------------------------------
create table if not exists freight_entries (
  id          uuid primary key default gen_random_uuid(),
  upload_id   uuid not null references freight_uploads(id) on delete cascade,
  route       text not null,
  spediteur   text not null,
  size        text not null check (size in ('20', '40', '40HC')),
  month       text not null,              -- Format "YYYY-MM"
  price       numeric not null,
  created_at  timestamptz not null default now()
);

create index if not exists freight_entries_upload_id_idx on freight_entries (upload_id);
create index if not exists freight_entries_route_idx     on freight_entries (route);

-- ----------------------------------------------------------------------------
-- Tabelle: freight_route_mapping — "Rohname der Route aus Excel" -> Anzeigename
-- ----------------------------------------------------------------------------
create table if not exists freight_route_mapping (
  route_raw     text primary key,
  route_display text not null,
  updated_at    timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================
-- RLS wird für alle drei Tabellen aktiviert. Ohne passende Policy blockiert
-- Supabase dann automatisch JEDEN Zugriff — das schützt die Tabellen davor,
-- versehentlich komplett offen zu sein. Erst die Policies unten erlauben
-- gezielt das, was das Dashboard aktuell braucht.

alter table freight_uploads        enable row level security;
alter table freight_entries        enable row level security;
alter table freight_route_mapping  enable row level security;

-- Aktueller Stand: Es gibt noch KEINEN Login (bewusst, siehe Aufgabenstellung).
-- Das Dashboard greift ausschließlich mit dem "anon" (öffentlichen) Schlüssel zu.
-- Damit Lesen/Schreiben/Löschen aus der App heraus funktioniert, erlauben wir
-- diese Aktionen hier für die Rolle "anon" (= jede:r mit dem Anon-Key, also
-- jede:r, der/die die Website aufruft).
--
-- WICHTIG FÜR SPÄTER: Sobald ihr einen Login einbaut, ersetzt in den Policies
-- unten "anon" durch "authenticated" (oder eine eigene Rolle) — dann kann nur
-- noch schreiben/löschen, wer eingeloggt ist. Lesen kann bei Bedarf weiterhin
-- öffentlich bleiben.

-- freight_uploads
create policy "freight_uploads_select_anon"
  on freight_uploads for select
  to anon
  using (true);

create policy "freight_uploads_insert_anon"
  on freight_uploads for insert
  to anon
  with check (true);

create policy "freight_uploads_delete_anon"
  on freight_uploads for delete
  to anon
  using (true);

-- freight_entries
create policy "freight_entries_select_anon"
  on freight_entries for select
  to anon
  using (true);

create policy "freight_entries_insert_anon"
  on freight_entries for insert
  to anon
  with check (true);

create policy "freight_entries_delete_anon"
  on freight_entries for delete
  to anon
  using (true);

-- freight_route_mapping
create policy "freight_route_mapping_select_anon"
  on freight_route_mapping for select
  to anon
  using (true);

create policy "freight_route_mapping_insert_anon"
  on freight_route_mapping for insert
  to anon
  with check (true);

create policy "freight_route_mapping_update_anon"
  on freight_route_mapping for update
  to anon
  using (true)
  with check (true);

-- Es gibt bewusst KEINE "update"-Policy für freight_uploads/freight_entries
-- und KEINE "delete"-Policy für freight_route_mapping, weil das Dashboard
-- diese Operationen aktuell nicht braucht — was nicht erlaubt ist, ist
-- automatisch verboten, das ist bei RLS der sichere Normalzustand.
