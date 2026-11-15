//! HEIC-Fotos (das Standardformat von iPhones) für den Assistenten. Claude Code liest nur PNG, JPEG, GIF und WebP, deshalb
//! wandelt die App ein HEIC-Foto beim Bereitstellen in ein JPEG um. Die Datei in der Datenbank bleibt unverändert.
//!
//! Der Decoder (`heifer`) ist reines Rust ohne C-Code. Weil die Dateien von außen kommen, läuft die Umwandlung trotzdem
//! abgesichert: in einem eigenen Thread, mit Obergrenzen für Dateigröße und Pixelzahl, mit Zeitlimit, und ein Fehler im
//! Decoder (auch eine Panik) wird zu einer Meldung statt zu einem Absturz der App. Dafür braucht das Release-Profil
//! `panic = "unwind"`.

use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// Größte Eingabedatei
const MAX_INPUT_BYTES: usize = 30_000_000;
/// Mehr Pixel (zum Beispiel ein 200-Megapixel-Foto) wird abgelehnt; ein iPhone liefert bis 48 Megapixel
const MAX_PIXELS: u64 = 64_000_000;
/// Längste Kante des JPEG. Claude verkleinert größere Bilder ohnehin; so bleibt die Datei klein.
const MAX_SIDE: usize = 2000;
const JPEG_QUALITY: u8 = 85;
const TIMEOUT: Duration = Duration::from_secs(60);
/// Der HEVC-Decoder arbeitet rekursiv, der Standard-Stapel eines Threads ist knapp
const STACK_BYTES: usize = 64 * 1024 * 1024;
/// So viele umgewandelte Fotos bleiben im Speicher, damit nicht jede Folgefrage neu rechnet
const CACHE_ENTRIES: usize = 6;

/// Ist die Datei ein HEIC- oder HEIF-Foto? Maßgeblich ist die Endung, ersatzweise der Typ.
pub fn is_heic(name: &str, mime: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "heic" | "heif" | "hif") || matches!(mime.trim().to_lowercase().as_str(), "image/heic" | "image/heif" | "image/heic-sequence" | "image/heif-sequence")
}

/// Der Dateiname des umgewandelten Fotos: `.jpg` statt `.heic`.
pub fn jpeg_name(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => format!("{stem}.jpg"),
        _ => format!("{name}.jpg"),
    }
}

type Entry = (i64, usize, Arc<Vec<u8>>);
static CACHE: Mutex<Vec<Entry>> = Mutex::new(Vec::new());

/// Wie [`to_jpeg`], aber ein schon umgewandeltes Foto (gleiche Datei, gleiche Größe) kommt aus dem Speicher.
pub fn cached_jpeg(id: i64, data: &[u8]) -> Result<Vec<u8>, String> {
    if let Ok(cache) = CACHE.lock() {
        if let Some((_, _, jpeg)) = cache.iter().find(|(i, len, _)| *i == id && *len == data.len()) {
            return Ok(jpeg.as_ref().clone());
        }
    }
    let jpeg = to_jpeg(data)?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.retain(|(i, _, _)| *i != id);
        if cache.len() >= CACHE_ENTRIES {
            cache.remove(0);
        }
        cache.push((id, data.len(), Arc::new(jpeg.clone())));
    }
    Ok(jpeg)
}

/// Wandelt ein HEIC-Foto in ein JPEG um (höchstens 2000 Pixel Kantenlänge). Fehler kommen als Satz, der sich hinter
/// „Inhalt nicht bereitgestellt:“ lesen lässt.
pub fn to_jpeg(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() > MAX_INPUT_BYTES {
        return Err("das HEIC-Foto ist größer als 30 MB".into());
    }
    let owned = data.to_vec();
    let (tx, rx) = mpsc::channel();
    let spawned = std::thread::Builder::new().name("heic".into()).stack_size(STACK_BYTES).spawn(move || {
        let result = std::panic::catch_unwind(|| convert(&owned));
        let _ = tx.send(result);
    });
    if spawned.is_err() {
        return Err("das HEIC-Foto lässt sich gerade nicht umwandeln".into());
    }
    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            log::error!("HEIC: der Decoder ist abgebrochen (Panik); das Foto wird übersprungen");
            Err("das HEIC-Foto ist beschädigt oder wird nicht unterstützt".into())
        }
        Err(_) => Err("die Umwandlung des HEIC-Fotos hat zu lange gedauert".into()),
    }
}

fn describe(error: heifer::Error) -> String {
    log::warn!("HEIC: {error}");
    match error {
        heifer::Error::Unsupported(_) => "das HEIC-Foto nutzt eine Funktion, die noch nicht unterstützt wird".into(),
        heifer::Error::Invalid(why) if why.to_lowercase().contains("pixel") => "das HEIC-Foto hat zu viele Pixel (mehr als 64 Megapixel)".into(),
        _ => "das HEIC-Foto ist beschädigt oder wird nicht unterstützt".into(),
    }
}

fn convert(data: &[u8]) -> Result<Vec<u8>, String> {
    let options = heifer::Options::new().with_max_pixels(MAX_PIXELS);
    let image = match heifer::decode_srgb_rgba8(data, &options) {
        Ok(image) => image,
        // Ein Farbraum, den der Decoder nicht umrechnet: das Foto so nehmen, wie es codiert ist
        Err(heifer::Error::Unsupported(_)) => heifer::decode_rgba8(data, &options).map_err(describe)?,
        Err(e) => return Err(describe(e)),
    };
    let (w, h) = (image.width as usize, image.height as usize);
    if w == 0 || h == 0 || image.data.len() < w * h * 4 {
        return Err("das HEIC-Foto ist leer".into());
    }
    let (rgb, out_w, out_h) = downscale(&image.data, w, h, MAX_SIDE);
    encode_jpeg(&rgb, out_w, out_h)
}

/// RGBA in RGB umrechnen und auf höchstens `max_side` Pixel Kantenlänge verkleinern (Mittelwert über die Fläche, die ein
/// neuer Pixel abdeckt). Der Alphakanal zählt nicht: Fotos sind deckend.
fn downscale(rgba: &[u8], w: usize, h: usize, max_side: usize) -> (Vec<u8>, usize, usize) {
    let longest = w.max(h);
    let (dw, dh) = if longest <= max_side { (w, h) } else { ((w * max_side / longest).max(1), (h * max_side / longest).max(1)) };
    let mut out = Vec::with_capacity(dw * dh * 3);
    for dy in 0..dh {
        let sy0 = dy * h / dh;
        let sy1 = ((dy + 1) * h / dh).max(sy0 + 1).min(h);
        for dx in 0..dw {
            let sx0 = dx * w / dw;
            let sx1 = ((dx + 1) * w / dw).max(sx0 + 1).min(w);
            let (mut r, mut g, mut b) = (0u32, 0u32, 0u32);
            for sy in sy0..sy1 {
                let row = sy * w * 4;
                for sx in sx0..sx1 {
                    let p = row + sx * 4;
                    r += u32::from(rgba[p]);
                    g += u32::from(rgba[p + 1]);
                    b += u32::from(rgba[p + 2]);
                }
            }
            let n = ((sy1 - sy0) * (sx1 - sx0)) as u32;
            out.extend_from_slice(&[(r / n) as u8, (g / n) as u8, (b / n) as u8]);
        }
    }
    (out, dw, dh)
}

fn encode_jpeg(rgb: &[u8], w: usize, h: usize) -> Result<Vec<u8>, String> {
    let (w16, h16) = (u16::try_from(w).map_err(|_| "das Foto ist zu groß".to_string())?, u16::try_from(h).map_err(|_| "das Foto ist zu groß".to_string())?);
    let mut out = Vec::new();
    jpeg_encoder::Encoder::new(&mut out, JPEG_QUALITY).encode(rgb, w16, h16, jpeg_encoder::ColorType::Rgb).map_err(|_| "das Foto lässt sich nicht als JPEG speichern".to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Breite und Höhe aus dem Kopf eines JPEG (Marker SOF0 bis SOF3)
    fn jpeg_size(jpeg: &[u8]) -> (usize, usize) {
        let mut i = 2;
        while i + 9 < jpeg.len() {
            if jpeg[i] != 0xFF {
                i += 1;
                continue;
            }
            let marker = jpeg[i + 1];
            if (0xC0..=0xC3).contains(&marker) {
                return (usize::from(jpeg[i + 7]) << 8 | usize::from(jpeg[i + 8]), usize::from(jpeg[i + 5]) << 8 | usize::from(jpeg[i + 6]));
            }
            i += 2 + (usize::from(jpeg[i + 2]) << 8 | usize::from(jpeg[i + 3]));
        }
        (0, 0)
    }

    /// Ein HEIC aus einem Farbverlauf, mit dem Encoder derselben Bibliothek erzeugt
    fn sample_heic(w: u32, h: u32) -> Vec<u8> {
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                rgb.extend_from_slice(&[(x * 255 / w.max(1)) as u8, (y * 255 / h.max(1)) as u8, 128]);
            }
        }
        heifer::encode_rgb8(w, h, &rgb, &heifer::EncodeOptions::default()).expect("Testfoto lässt sich erzeugen")
    }

    #[test]
    fn heic_files_are_recognized_by_extension_or_type() {
        assert!(is_heic("IMG_0001.HEIC", ""));
        assert!(is_heic("foto.heif", "application/octet-stream"));
        assert!(is_heic("ohne-endung", "image/heic"));
        assert!(!is_heic("foto.jpg", "image/jpeg"));
        assert!(!is_heic("heic", ""));
        assert_eq!(jpeg_name("IMG_0001.HEIC"), "IMG_0001.jpg");
        assert_eq!(jpeg_name("a.b.heif"), "a.b.jpg");
        assert_eq!(jpeg_name("ohne"), "ohne.jpg");
    }

    #[test]
    fn a_heic_photo_becomes_a_jpeg_of_the_same_size() {
        let heic = sample_heic(96, 64);
        let jpeg = to_jpeg(&heic).unwrap();
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF], "JPEG-Kopf");
        assert_eq!(jpeg_size(&jpeg), (96, 64));
    }

    #[test]
    fn large_photos_are_scaled_down_and_keep_their_proportions() {
        let rgba: Vec<u8> = (0..3000 * 1500).flat_map(|i| [(i % 251) as u8, 80, 160, 255]).collect();
        let (rgb, w, h) = downscale(&rgba, 3000, 1500, 2000);
        assert_eq!((w, h), (2000, 1000));
        assert_eq!(rgb.len(), 2000 * 1000 * 3);

        let (_, w, h) = downscale(&rgba[..400 * 4], 20, 20, 2000);
        assert_eq!((w, h), (20, 20), "kleine Fotos bleiben");

        let (rgb, w, h) = downscale(&[10, 20, 30, 255, 30, 40, 50, 255], 2, 1, 1);
        assert_eq!((w, h), (1, 1), "ein Pixel mittelt die Fläche");
        assert_eq!(rgb, [20, 30, 40]);
    }

    #[test]
    fn broken_files_give_a_message_and_never_a_panic() {
        assert!(to_jpeg(b"das ist kein foto").unwrap_err().contains("HEIC-Foto"));
        assert!(to_jpeg(&[]).is_err());

        // Ein abgeschnittenes echtes HEIC
        let heic = sample_heic(64, 64);
        assert!(to_jpeg(&heic[..heic.len() / 2]).is_err());
        // Zufällig verfälschte Bytes dürfen den Decoder nicht zum Absturz bringen
        let mut damaged = heic.clone();
        for (i, b) in damaged.iter_mut().enumerate().skip(40).step_by(7) {
            *b = b.wrapping_add(i as u8 | 1);
        }
        let _ = to_jpeg(&damaged);
    }

    #[test]
    fn oversized_input_is_refused_before_decoding() {
        let big = vec![0u8; MAX_INPUT_BYTES + 1];
        assert!(to_jpeg(&big).unwrap_err().contains("30 MB"));
    }

    #[test]
    fn a_converted_photo_is_served_from_the_cache() {
        let heic = sample_heic(48, 48);
        let first = cached_jpeg(9001, &heic).unwrap();
        // Dieselbe Datei und Größe: Ergebnis aus dem Speicher, auch wenn die Bytes selbst nicht mehr stimmen würden
        let mut same_len = heic.clone();
        same_len[10] ^= 0xFF;
        assert_eq!(cached_jpeg(9001, &same_len).unwrap(), first);
        // Eine andere Größe zählt als andere Datei
        assert!(cached_jpeg(9001, &heic[..heic.len() - 1]).is_err());
    }
}
