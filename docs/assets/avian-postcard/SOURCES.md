# Anna's Hummingbird postcard sources

This directory is a self-contained article fixture. It does not call a live station API.

## Illustration and stamp

- `anna-perched.webp` and `anna-flight.webp` are optimized copies of the production Atlas illustrations `avian/assets/illustrations/calypte-anna.png` and `avian/assets/illustrations/calypte-anna-2.png` from AvianVisitors v1.
- The embedded card renders Hummingbirds issue 7 through the same JavaScript stamp templates, canvas treatment, illustration, type, and perforation fringe as the production Atlas. `anna-stamp.webp` is retained only as a no-script/error fallback.
- The two pose glyphs in `avian-postcard.js` use Font Awesome Free 6 bird glyph paths, available under [CC BY 4.0](https://fontawesome.com/license/free).

## Recordings

These project-owned station recordings were already selected for the public AvianVisitors release media. The shipped MP3s have been loudness-normalized for the article and stripped of embedded metadata. The WebP spectrograms are transparent monochrome conversions of their matching release-fixture spectrograms; the recorded signal is unchanged.

| Shipped file | Source recording filename | Heard | Confidence | Spectrogram source |
| --- | --- | --- | ---: | --- |
| `recording-2026-08-18-173214.mp3` | `Annas_Hummingbird-99-2026-08-18-birdnet-17:32:14.mp3` | 2026-08-18 17:32:14 | 99.35% | `anna-cand-9935-0818-173214-spec2.png` |
| `recording-2026-08-17-185729.mp3` | `Annas_Hummingbird-99-2026-08-17-birdnet-18:57:29.mp3` | 2026-08-17 18:57:29 | 99.33% | `anna-cand-9933-0817-185729-spec2.png` |
| `recording-2026-08-17-185618.mp3` | `Annas_Hummingbird-99-2026-08-17-birdnet-18:56:18.mp3` | 2026-08-17 18:56:18 | 99.32% | `anna-cand-9932-0817-185618-spec2.png` |

## Copy

The two About paragraphs and field-mark note are the complete source sentences selected by AvianVisitors' production `wiki.php` field-guide formatter from [Wikipedia's Anna's hummingbird article](https://en.wikipedia.org/wiki/Anna%27s_hummingbird), under CC BY-SA 4.0. Taxonomy and external reference links match the production postcard.
