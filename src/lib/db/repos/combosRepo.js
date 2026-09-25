import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function inferKindFromModels(models, name) {
  const modelStrs = models.map((m) => typeof m === "string" ? m : (m?.model || m?.id || m?.name || "")).filter(Boolean);
  if (modelStrs.length === 0) {
    if (name && /jev|systemone/i.test(name)) return "systemone";
    return null;
  }
  const isAllSystemone = modelStrs.every((m) => /jev|systemone|typesafe/i.test(m));
  if (isAllSystemone) return "systemone";
  const isAllImage = modelStrs.every((m) => /image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion|recraft|midjourney|ideogram/i.test(m));
  if (isAllImage) return "image";
  const isAllTts = modelStrs.every((m) => /tts|speech|voice|eleven|cartesia|polly/i.test(m));
  if (isAllTts) return "tts";
  const isAllEmbedding = modelStrs.every((m) => /embed|text-embedding/i.test(m));
  if (isAllEmbedding) return "embedding";
  return null;
}

function rowToCombo(row) {
  if (!row) return null;
  const models = parseJson(row.models, []);
  const kind = row.kind || inferKindFromModels(models, row.name);
  return {
    id: row.id,
    name: row.name,
    kind: kind || null,
    models,
    isActive: row.isActive === undefined || row.isActive === null ? true : (row.isActive === 1 || row.isActive === true),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos(filter = {}) {
  const db = await getAdapter();
  let query = `SELECT * FROM combos`;
  const params = [];
  if (filter.isActive !== undefined) {
    query += ` WHERE isActive = ?`;
    params.push(filter.isActive ? 1 : 0);
  }
  query += ` ORDER BY createdAt ASC`;
  const rows = db.all(query, params);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    isActive: data.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, isActive, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.isActive ? 1 : 0, combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.isActive !== false ? 1 : 0, merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
