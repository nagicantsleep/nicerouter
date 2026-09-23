// Shim → re-export from SQLite-based DB layer (src/lib/db/)
export {
  getDeletedModels, getDeletedByProvider, deleteModels, restoreDeletedModels,
} from "./db/index.js";
