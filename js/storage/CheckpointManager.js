'use strict';

import { STORAGE_KEYS } from '../utils/Constants.js';
import { toPayload, fromPayload } from '../ai/NetworkSerializer.js';

/**
 * CheckpointManager — champion persistence on top of localStorage.
 * Save/load/export/import all pass through the serializer's validation;
 * corrupt data is rejected (returns null / throws to the caller's catch).
 */
export class CheckpointManager {
  constructor(storage) { this.storage = storage; }

  save(net, meta) {
    const payload = toPayload(net, meta);
    try { localStorage.setItem(STORAGE_KEYS.checkpoint, JSON.stringify(payload)); }
    catch { return false; } // quota exceeded — training continues, saving just fails
    return true;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.checkpoint);
      if (!raw) return null;
      return fromPayload(JSON.parse(raw));
    } catch {
      return null; // malformed/corrupt -> fresh start, app unaffected
    }
  }

  loadMeta() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.checkpoint);
      if (!raw) return null;
      const data = JSON.parse(raw);
      fromPayload(data); // validate before trusting metadata
      return {
        fitness: data.fitness,
        generation: data.generation,
        activation: data.network.activation,
        savedAt: data.savedAt,
        score: data.score,
      };
    } catch { return null; }
  }

  exportJSON(net, meta) {
    return JSON.stringify(toPayload(net, { ...meta, savedAt: new Date().toISOString() }), null, 2);
  }

  /** Returns { net, meta } or throws on invalid JSON/shape. */
  importJSON(text) {
    const data = JSON.parse(text);
    const net = fromPayload(data);
    return {
      net,
      meta: {
        fitness: data.fitness,
        generation: data.generation,
        activation: data.network.activation,
        score: data.score,
        importedAt: new Date().toISOString(),
      },
    };
  }

  clear() {
    try { localStorage.removeItem(STORAGE_KEYS.checkpoint); } catch { /* noop */ }
  }
}
