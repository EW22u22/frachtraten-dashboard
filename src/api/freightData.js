import { supabase } from "../supabaseClient.js";

const ENTRIES_TABLE = "freight_entries";
const UPLOADS_TABLE = "freight_uploads";
const MAPPING_TABLE = "freight_route_mapping";

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

  const [uploadsRes, entriesRes, mappingRes] = await Promise.all([
    supabase.from(UPLOADS_TABLE).select("*").order("added_at", { ascending: true }),
    supabase.from(ENTRIES_TABLE).select("*"),
    supabase.from(MAPPING_TABLE).select("*"),
  ]);

  if (uploadsRes.error) throw uploadsRes.error;
  if (entriesRes.error) throw entriesRes.error;
  if (mappingRes.error) throw mappingRes.error;

  const uploads = (uploadsRes.data || []).map((u) => ({
    id: u.id,
    filename: u.filename,
    month: u.month,
    addedAt: u.added_at,
  }));

  const entries = (entriesRes.data || []).map((e) => ({
    id: e.id,
    uploadId: e.upload_id,
    route: e.route,
    spediteur: e.spediteur,
    size: e.size,
    month: e.month,
    price: Number(e.price),
  }));

  const routeMapping = {};
  (mappingRes.data || []).forEach((r) => {
    routeMapping[r.route_raw] = r.route_display;
  });

  return { uploads, entries, routeMapping };
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
