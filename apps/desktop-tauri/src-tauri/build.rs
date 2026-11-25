use std::path::Path;

fn main() {
    // An installer without the playback engine looks fine until the first play,
    // so a release build refuses to continue without the library.
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let library = Path::new("vendor/mpv/libmpv-2.dll");
        if !library.exists() {
            panic!(
                "{} is missing; run `pnpm --filter @filmsnaps/desktop-tauri fetch:libmpv` before bundling",
                library.display()
            );
        }
    }
    tauri_build::build()
}
