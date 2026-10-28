//! WebAssembly entry point: replays a kyoku's mjai log from one seat with
//! libriichi's `PlayerState` and encodes Mortal's observation of the last
//! event. A plain C ABI (no wasm-bindgen): the caller writes the log into
//! memory from `alloc`, calls `encode`, then reads the buffers below.
use riichi::mjai::Event;
use riichi::state::{ActionCandidate, PlayerState};
use std::cell::RefCell;

/// `flags` bit: the game is East-only (see `PlayerState::tonpuusen`).
const FLAG_TONPUUSEN: u32 = 1;

#[derive(Default)]
struct Output {
    obs: Vec<f32>,
    mask: Vec<u8>,
    kan_obs: Vec<f32>,
    kan_mask: Vec<u8>,
    cans: u32,
    error: String,
}

thread_local! {
    static OUT: RefCell<Output> = RefCell::new(Output::default());
}

fn cans_bits(c: &ActionCandidate) -> u32 {
    [
        c.can_discard,
        c.can_chi_low,
        c.can_chi_mid,
        c.can_chi_high,
        c.can_pon,
        c.can_daiminkan,
        c.can_kakan,
        c.can_ankan,
        c.can_riichi,
        c.can_tsumo_agari,
        c.can_ron_agari,
        c.can_ryukyoku,
    ]
    .iter()
    .enumerate()
    .fold(0, |bits, (i, &b)| bits | (u32::from(b) << i))
}

fn run(log: &str, seat: u8, version: u32, flags: u32) -> anyhow::Result<Output> {
    let events: Vec<Event> = serde_json::from_str(log)?;
    let mut state = PlayerState::new(seat);
    state.tonpuusen = flags & FLAG_TONPUUSEN != 0;
    let mut cans = ActionCandidate::default();
    for ev in &events {
        cans = state.update(ev)?;
    }
    let mut out = Output { cans: cans_bits(&cans), ..Default::default() };
    if !cans.can_act() {
        return Ok(out);
    }
    let (obs, mask) = state.encode_obs(version, false);
    out.obs = obs.into_raw_vec_and_offset().0;
    out.mask = mask.iter().map(|&b| u8::from(b)).collect();
    if cans.can_ankan || cans.can_kakan {
        let (obs, mask) = state.encode_obs(version, true);
        out.kan_obs = obs.into_raw_vec_and_offset().0;
        out.kan_mask = mask.iter().map(|&b| u8::from(b)).collect();
    }
    Ok(out)
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` and `len` must come from one `alloc` call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    // SAFETY: allocated by `alloc` with this capacity
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
}

/// Encodes the observation after the last event of `log` (a JSON array of
/// mjai events from `seat`'s point of view). Returns 1 when the seat can
/// act, 0 when it cannot, -1 on error (see `error_ptr`).
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encode(ptr: *const u8, len: usize, seat: u32, version: u32, flags: u32) -> i32 {
    // SAFETY: the caller wrote `len` bytes at `ptr`
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let result = std::str::from_utf8(bytes)
        .map_err(anyhow::Error::from)
        .and_then(|log| run(log, seat as u8, version, flags));
    OUT.with_borrow_mut(|out| match result {
        Ok(o) => {
            *out = o;
            i32::from(!out.obs.is_empty())
        }
        Err(e) => {
            *out = Output { error: format!("{e:?}"), ..Default::default() };
            -1
        }
    })
}

macro_rules! getter {
    ($ptr:ident, $len:ident, $field:ident, $t:ty) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $ptr() -> *const $t {
            OUT.with_borrow(|o| o.$field.as_ptr())
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $len() -> usize {
            OUT.with_borrow(|o| o.$field.len())
        }
    };
}

getter!(obs_ptr, obs_len, obs, f32);
getter!(mask_ptr, mask_len, mask, u8);
getter!(kan_obs_ptr, kan_obs_len, kan_obs, f32);
getter!(kan_mask_ptr, kan_mask_len, kan_mask, u8);

#[unsafe(no_mangle)]
pub extern "C" fn error_ptr() -> *const u8 {
    OUT.with_borrow(|o| o.error.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn error_len() -> usize {
    OUT.with_borrow(|o| o.error.len())
}

/// Bits: discard, chi low/mid/high, pon, daiminkan, kakan, ankan, riichi,
/// tsumo, ron, ryukyoku (kyuushu), from bit 0 up.
#[unsafe(no_mangle)]
pub extern "C" fn cans() -> u32 {
    OUT.with_borrow(|o| o.cans)
}
