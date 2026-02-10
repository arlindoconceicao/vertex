use wasm_bindgen::prelude::*;

pub fn set_panic_hook() {
    // Quando a flag "console_error_panic_hook" estiver ativa,
    // erros do Rust aparecem no console do navegador/Electron.
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

