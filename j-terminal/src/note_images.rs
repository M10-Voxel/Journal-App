//! Decode the app's AVIF attachments for in-window display.
use std::{fs::File, io::Read};

use avif_decode::Image;
use image::{Rgba, RgbaImage};
use crate::notebook::ImageSource;

pub fn decode(source: &ImageSource, size: u32) -> Option<RgbaImage> {
    const MAX_INPUT: u64 = 24_000_000;
    let owned;
    let bytes: &[u8] = match source {
        ImageSource::Bytes(bytes) => bytes,
        ImageSource::File(path) => {
            let mut data = Vec::new();
            File::open(path).ok()?.take(MAX_INPUT + 1).read_to_end(&mut data).ok()?;
            owned = data;
            &owned
        }
    };
    if bytes.len() as u64 > MAX_INPUT { return None; }

    // Check both AV1 sequence headers before allocating a decode surface.
    let container = avif_parse::read_avif(&mut &bytes[..]).ok()?;
    let valid = |metadata: avif_parse::AV1Metadata| {
        u64::from(metadata.max_frame_width.get()) * u64::from(metadata.max_frame_height.get()) <= 16_777_216
    };
    if !valid(container.primary_item_metadata().ok()?) || container.alpha_item_metadata().ok()?.is_some_and(|alpha| !valid(alpha)) {
        return None;
    }
    drop(container);

    macro_rules! convert {
        ($image:expr, $color:expr) => {{
            let (pixels, width, height) = $image.into_contiguous_buf();
            let pixels: Vec<u8> = pixels.into_iter().flat_map($color).collect();
            RgbaImage::from_vec(width as u32, height as u32, pixels)?
        }};
    }
    let byte = |value: u16| (value >> 8) as u8;
    let image = match avif_decode::Decoder::from_avif(bytes).ok()?.to_image().ok()? {
        Image::Rgb8(i) => convert!(i, |p| [p.r, p.g, p.b, 255]),
        Image::Rgba8(i) => convert!(i, |p| [p.r, p.g, p.b, p.a]),
        Image::Rgb16(i) => convert!(i, |p| [byte(p.r), byte(p.g), byte(p.b), 255]),
        Image::Rgba16(i) => convert!(i, |p| [byte(p.r), byte(p.g), byte(p.b), byte(p.a)]),
        Image::Gray8(i) => convert!(i, |p| [p.value(), p.value(), p.value(), 255]),
        Image::Gray16(i) => convert!(i, |p| { let px = byte(p.value()); [px, px, px, 255] }),
    };
    if image.width().max(image.height()) <= size { return Some(image); }
    let ratio = f64::from(size) / f64::from(image.width().max(image.height()));
    let width = (f64::from(image.width()) * ratio).round().max(1.0) as u32;
    let height = (f64::from(image.height()) * ratio).round().max(1.0) as u32;
    Some(image::imageops::resize(&image, width, height, image::imageops::FilterType::Triangle))
}

pub fn to_slint(image: &RgbaImage) -> slint::Image {
    let mut pixels = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(image.width(), image.height());
    for (dst, Rgba([r, g, b, a])) in pixels.make_mut_slice().iter_mut().zip(image.pixels()) {
        *dst = slint::Rgba8Pixel { r: *r, g: *g, b: *b, a: *a };
    }
    slint::Image::from_rgba8(pixels)
}

/// Pre-asset cards can carry a local data URL instead of a vault-relative AVIF.
pub fn inline(url:&str,size:u32)->Option<RgbaImage>{
    use base64::{engine::general_purpose::STANDARD,Engine};
    let (mime,data)=url.split_once(',')?;
    if data.len()>2_000_000 || !matches!(mime,"data:image/avif;base64"|"data:image/jpeg;base64"|"data:image/png;base64"|"data:image/webp;base64"){return None}
    let bytes=STANDARD.decode(data).ok()?;
    if mime=="data:image/avif;base64"{return decode(&ImageSource::Bytes(bytes.into()),size)}
    let input=std::io::Cursor::new(bytes);
    let mut reader=image::ImageReader::new(input).with_guessed_format().ok()?;
    let mut limits=image::Limits::default();limits.max_alloc=Some(64*1024*1024);limits.max_image_width=Some(8192);limits.max_image_height=Some(8192);reader.limits(limits);
    Some(reader.decode().ok()?.thumbnail(size,size).into_rgba8())
}
