// Mortal's observation encoder (libriichi compiled to WebAssembly, see
// mortal/README.md). encode(events, seat) replays a kyoku's mjai events from
// that seat and returns what Mortal's network reads at the last event.
import { readFileSync } from 'node:fs';

let wasm = null;

function load() {
  if (!wasm) {
    const bytes = readFileSync(new URL('./encoder.wasm', import.meta.url));
    wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
  }
  return wasm;
}

export const OBS_ROWS = 1012; // observation version 4
export const ACTIONS = 46;

// Action candidates, in the order of the encoder's bit field.
const CANS = ['discard', 'chiLow', 'chiMid', 'chiHigh', 'pon', 'daiminkan', 'kakan', 'ankan', 'riichi', 'tsumo', 'ron', 'ryukyoku'];

// -> null when the seat cannot act at the last event, else
//    { obs: Float32Array, mask: Uint8Array, kan: {obs, mask} | null, cans }
// tonpuusen: an East-only game, shown to Mortal as the South round of a hanchan.
export function encode(events, seat, { tonpuusen = false, version = 4 } = {}) {
  const w = load();
  const bytes = new TextEncoder().encode(JSON.stringify(events));
  const ptr = w.alloc(bytes.length);
  new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
  let status;
  try {
    status = w.encode(ptr, bytes.length, seat, version, tonpuusen ? 1 : 0);
  } catch (e) {
    wasm = null; // a trap (Rust panic) leaves the instance unusable
    throw e;
  }
  w.dealloc(ptr, bytes.length);
  const mem = w.memory.buffer;
  if (status < 0) {
    throw new Error(`mortal encoder: ${new TextDecoder().decode(new Uint8Array(mem, w.error_ptr(), w.error_len()))}`);
  }
  if (status === 0) return null;
  const bits = w.cans();
  const cans = Object.fromEntries(CANS.map((name, i) => [name, !!(bits & (1 << i))]));
  const copy = (Type, p, n) => new Type(mem, p, n).slice();
  const out = {
    obs: copy(Float32Array, w.obs_ptr(), w.obs_len()),
    mask: copy(Uint8Array, w.mask_ptr(), w.mask_len()),
    kan: null,
    cans,
  };
  if (w.kan_obs_len()) {
    out.kan = {
      obs: copy(Float32Array, w.kan_obs_ptr(), w.kan_obs_len()),
      mask: copy(Uint8Array, w.kan_mask_ptr(), w.kan_mask_len()),
    };
  }
  return out;
}
