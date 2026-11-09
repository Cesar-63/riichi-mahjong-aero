//! Mortal's libriichi without the Python layer: player state driven by mjai
//! events and the observation encoder that feeds Mortal's network.
#![allow(clippy::manual_range_patterns)]

mod array;
mod macros;
mod rankings;
mod vec_ops;

pub mod algo;
pub mod chi_type;
pub mod consts;
pub mod hand;
pub mod mjai;
pub mod state;
pub mod tile;
