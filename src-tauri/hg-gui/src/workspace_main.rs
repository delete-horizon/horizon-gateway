#![allow(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    horizon_gateway_lib::run_workspace();
}
