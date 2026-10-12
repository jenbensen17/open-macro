// Barcode scanning via ZXing (vendored, lazy-loaded) on the rear camera.
let zxingLoaded;
function loadZxing() {
  if (window.ZXing) return Promise.resolve();
  zxingLoaded ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Could not load scanner'));
    document.head.appendChild(s);
  });
  return zxingLoaded;
}

/** Starts scanning into `video`. Resolves `onCode(text)` once; returns a stop() function. */
export async function startScan(video, onCode, onError) {
  await loadZxing();
  const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = window.ZXing;
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints, 300);
  let done = false;
  const stop = () => { done = true; try { reader.reset(); } catch { /* ignore */ } };
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try {
    await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      video,
      (result) => { if (result && !done) { stop(); onCode(result.getText()); } },
    );
  } catch (e) { stop(); onError(e); }
  return stop;
}
