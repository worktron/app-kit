import { followTextSize, onPageReturn } from '../..';

// A page whose text follows the phone's Text Size, which prints the scale it read. With ?report it also sends each
// reading to /reading, with what the browser answered and whether the page had just loaded or come back in front, for
// a run on a simulated iPhone that records test/fixtures/text-size-readings.json.

const loadId = crypto.randomUUID();
const report = new URLSearchParams(location.search).has('report');

/** What Apple's body text style answers here, measured the way the kit measures it. */
function bodyPx(): number {
  const probe = document.createElement('span');
  probe.style.setProperty('font', '-apple-system-body', 'important');
  document.body.append(probe);
  const px = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return px;
}

function show(on: 'load' | 'return') {
  const scale = document.documentElement.style.getPropertyValue('--text-scale');
  document.getElementById('scale')!.textContent = scale;
  if (!report) return;
  const reading = {
    scale: Number(scale),
    rootFontSize: getComputedStyle(document.documentElement).fontSize,
    supports: CSS.supports('font', '-apple-system-body'),
    touchPoints: navigator.maxTouchPoints,
    bodyPx: bodyPx(),
    loadId,
    on,
  };
  void fetch('/reading', { method: 'POST', body: JSON.stringify(reading) });
}

followTextSize();
show('load');
onPageReturn(() => show('return'));
