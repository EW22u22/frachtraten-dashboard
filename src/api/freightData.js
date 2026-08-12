import { supabase } from "../supabaseClient.js";

const ENTRIES_TABLE = "freight_entries";
const UPLOADS_TABLE = "freight_uploads";
const MAPPING_TABLE = "freight_route_mapping";

// PostgREST (die API-Schicht hinter Supabase) liefert bei .select() ohne
// explizite Pagination standardmäßig nur bis zu einer projektweiten
// Maximalzeilenzahl zurück (üblich: 1000) — ohne Fehlermeldung, einfach
// stillschweigend abgeschnitten. Bei wachsendem Datenbestand (mehrere Jahre,
// Routen, Größen, Monate, Spediteure) kann das schnell überschritten werden.
// fetchAllRows liest deshalb in Seiten von PAGE_SIZE Zeilen, bis wirklich
// alles geladen ist.
const PAGE_SIZE = 1000;

async function fetchAllRows(table, orderColumn) {
  const allRows = [];
  let from = 0;
  // Sicherheitsgrenze, damit ein unerwarteter Serverfehler nicht zu einer
  // Endlosschleife führt.
  for (let page = 0; page < 1000; page++) {
    let query = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    allRows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows;
}

function assertClient() {
  if (!supabase) {
    throw new Error(
      "Supabase ist nicht konfiguriert. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der .env-Datei setzen (siehe .env.example)."
    );
  }
}

/**
 * Lädt den kompletten gemeinsamen Datenstand (Uploads, Einzelwerte,
 * Routen-Zuordnung) aus Supabase. Wird beim Öffnen des Dashboards aufgerufen.
 */
export async function loadAllData() {
  assertClient();

  const [uploads, entriesRaw, mappingRows] = await Promise.all([
    fetchAllRows(UPLOADS_TABLE, "added_at"),
    fetchAllRows(ENTRIES_TABLE),
    fetchAllRows(MAPPING_TABLE),
  ]);

  const uploadsOut = uploads.map((u) => ({
    id: u.id,
    filename: u.filename,
    month: u.month,
    addedAt: u.added_at,
  }));

  const entries = entriesRaw.map((e) => ({
    id: e.id,
    uploadId: e.upload_id,
    route: e.route,
    spediteur: e.spediteur,
    size: e.size,
    month: e.month,
    price: Number(e.price),
  }));

  const routeMapping = {};
  mappingRows.forEach((r) => {
    routeMapping[r.route_raw] = r.route_display;
  });

  return { uploads: uploadsOut, entries, routeMapping };
}

/**
 * Speichert eine oder mehrere geprüfte Import-Batches dauerhaft:
 * legt je Batch einen Upload-Datensatz an, fügt die zugehörigen Werte ein
 * und aktualisiert die Routen-Zuordnung (upsert).
 */
export async function saveBatchesToSupabase(pendingBatches) {
  assertClient();

  const createdUploads = [];
  const createdEntries = [];
  const mappingUpdates = {};

  for (const batch of pendingBatches) {
    const { data: uploadRow, error: uploadError } = await supabase
      .from(UPLOADS_TABLE)
      .insert({ filename: batch.filename, month: batch.month })
      .select()
      .single();

    if (uploadError) throw uploadError;

    createdUploads.push({
      id: uploadRow.id,
      filename: uploadRow.filename,
      month: uploadRow.month,
      addedAt: uploadRow.added_at,
    });

    const rowsToInsert = batch.items
      .filter((it) => it.include)
      .map((it) => ({
        upload_id: uploadRow.id,
        route: it.route,
        spediteur: it.spediteur,
        size: it.size,
        month: batch.month,
        price: Number(it.price),
      }));

    if (rowsToInsert.length > 0) {
      const { data: insertedEntries, error: entriesError } = await supabase
        .from(ENTRIES_TABLE)
        .insert(rowsToInsert)
        .select();

      if (entriesError) throw entriesError;

      insertedEntries.forEach((e) => {
        createdEntries.push({
          id: e.id,
          uploadId: e.upload_id,
          route: e.route,
          spediteur: e.spediteur,
          size: e.size,
          month: e.month,
          price: Number(e.price),
        });
      });
    }

    batch.items.forEach((it) => {
      mappingUpdates[it.routeRaw] = it.route;
    });
  }

  const mappingRows = Object.entries(mappingUpdates).map(([routeRaw, routeDisplay]) => ({
    route_raw: routeRaw,
    route_display: routeDisplay,
  }));

  if (mappingRows.length > 0) {
    const { error: mappingError } = await supabase
      .from(MAPPING_TABLE)
      .upsert(mappingRows, { onConflict: "route_raw" });
    if (mappingError) throw mappingError;
  }

  return { createdUploads, createdEntries, mappingUpdates };
}

/**
 * Löscht einen Import zentral. Die zugehörigen Werte werden durch die
 * Datenbank-Fremdschlüsselregel (ON DELETE CASCADE) automatisch mitgelöscht.
 */
export async function deleteUploadFromSupabase(uploadId) {
  assertClient();
  const { error } = await supabase.from(UPLOADS_TABLE).delete().eq("id", uploadId);
  if (error) throw error;
}
