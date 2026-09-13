/**
 * AdsForecast — lightweight SVG chart (spend vs revenue), no dependencies.
 * Grid, axes, legend, and pointer tooltips for the performance series.
 * @module chart
 */

/**
 * @param {HTMLElement | null} root
 * @param {{ points?: Array<{ date: string, spend: number, revenue: number }> }} series
 * @param {{ currency?: string, source?: "live" | "demo" }} options
 */
export function renderSpendRevenueChart(root, series, options = {}) {
  if (!root) return;
  const points = series?.points;
  if (!Array.isArray(points) || points.length === 0) {
    root.innerHTML = `
      <div class="performance-chart__empty" role="status">
        <strong>Daily trend is not available yet</strong>
        <span>Campaign totals are live. A daily chart will appear after time-series sync is enabled.</span>
      </div>`;
    return;
  }

  const currency = String(options.currency || "USD").toUpperCase();
  const isDemo = options.source === "demo";

  const uid =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : String(Date.now());

  const W = 640;
  const H = 300;
  const padL = 56;
  const padR = 20;
  const padT = 28;
  const padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  let maxY = 0;
  for (const p of points) {
    maxY = Math.max(maxY, p.spend ?? 0, p.revenue ?? 0);
  }
  if (maxY <= 0) maxY = 1;
  maxY *= 1.06;

  const n = points.length;
  const xAt = (i) => padL + innerW * (n === 1 ? 0.5 : i / (n - 1));
  const yAt = (v) => padT + innerH * (1 - v / maxY);

  const spendPts = points
    .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.spend ?? 0).toFixed(1)}`)
    .join(" ");
  const revPts = points
    .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.revenue ?? 0).toFixed(1)}`)
    .join(" ");

  const revFillPoly = [
    `${padL.toFixed(1)},${(padT + innerH).toFixed(1)}`,
    ...points.map(
      (p, i) => `${xAt(i).toFixed(1)},${yAt(p.revenue ?? 0).toFixed(1)}`
    ),
    `${(padL + innerW).toFixed(1)},${(padT + innerH).toFixed(1)}`,
  ].join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padT + innerH * t;
    return `<line class="performance-chart__grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + innerW}" y2="${y.toFixed(1)}" />`;
  });

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const val = maxY * (1 - t);
    const y = padT + innerH * t;
    const label = formatAxisMoney(val);
    return `<text class="performance-chart__tick performance-chart__tick--y" x="${padL - 10}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${escapeSvgText(label)}</text>`;
  });

  const xLabels = points.map((p, i) => {
    const d = formatShortDate(p.date);
    const x = xAt(i);
    return `<text class="performance-chart__tick performance-chart__tick--x" x="${x.toFixed(1)}" y="${H - 14}" text-anchor="middle">${escapeSvgText(d)}</text>`;
  });

  root.innerHTML = `
    <div class="performance-chart__shell">
      <div class="performance-chart__head">
        <span class="performance-chart__head-title">Spend vs revenue</span>
        <span class="performance-chart__head-sub">Daily · ${escapeHtml(currency)}${isDemo ? " · Sample data" : ""}</span>
      </div>
      <div class="performance-chart__plot" id="performance-chart-plot-${uid}">
        <svg class="performance-chart__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily spend and revenue for the last ${n} days">
          <title>Daily spend and revenue</title>
          <defs>
            <linearGradient id="perf-rev-fill-${uid}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(134, 239, 172, 0.2)"/>
              <stop offset="100%" stop-color="rgba(134, 239, 172, 0)"/>
            </linearGradient>
          </defs>
          <line class="performance-chart__axis-y" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" />
          <line class="performance-chart__axis-x" x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" />
          ${gridLines.join("")}
          <rect x="${padL}" y="${padT}" width="${innerW}" height="${innerH}" fill="rgba(255,255,255,0.02)" rx="4"/>
          ${yTicks.join("")}
          <polygon fill="url(#perf-rev-fill-${uid})" points="${revFillPoly}" opacity="0.88"/>
          <polyline class="performance-chart__line performance-chart__line--spend" fill="none" stroke="rgba(252, 165, 165, 0.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${spendPts}"/>
          <polyline class="performance-chart__line performance-chart__line--revenue" fill="none" stroke="rgba(134, 239, 172, 0.95)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${revPts}"/>
          ${points
            .map((p, i) => {
              const cx = xAt(i);
              const ys = yAt(p.spend ?? 0);
              const yr = yAt(p.revenue ?? 0);
              return `<circle class="performance-chart__dot performance-chart__dot--spend" cx="${cx.toFixed(1)}" cy="${ys.toFixed(1)}" r="3.5" data-idx="${i}" />
                <circle class="performance-chart__dot performance-chart__dot--revenue" cx="${cx.toFixed(1)}" cy="${yr.toFixed(1)}" r="3.5" data-idx="${i}" />`;
            })
            .join("")}
          ${xLabels.join("")}
        </svg>
        <div class="performance-chart__tooltip" id="performance-chart-tooltip-${uid}" hidden></div>
      </div>
      <div class="performance-chart__legend">
        <span class="performance-chart__legend-item"><span class="performance-chart__swatch performance-chart__swatch--revenue"></span> Revenue</span>
        <span class="performance-chart__legend-item"><span class="performance-chart__swatch performance-chart__swatch--spend"></span> Spend</span>
      </div>
    </div>`;

  const plot = root.querySelector(`#performance-chart-plot-${uid}`);
  const tooltip = root.querySelector(`#performance-chart-tooltip-${uid}`);
  const svg = root.querySelector("svg");
  if (!(plot instanceof HTMLElement) || !(tooltip instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
    return;
  }

  /** @param {number} idx */
  function showTooltip(idx) {
    const p = points[idx];
    if (!p) return;
    const dateLabel = formatLongDate(p.date);
    tooltip.innerHTML = `
      <span class="performance-chart__tooltip-date">${escapeHtml(dateLabel)}</span>
      <span class="performance-chart__tooltip-row"><span class="performance-chart__tooltip-k">Revenue</span> <span class="performance-chart__tooltip-v performance-chart__tooltip-v--rev">${escapeHtml(formatMoney(p.revenue ?? 0, currency))}</span></span>
      <span class="performance-chart__tooltip-row"><span class="performance-chart__tooltip-k">Spend</span> <span class="performance-chart__tooltip-v performance-chart__tooltip-v--spend">${escapeHtml(formatMoney(p.spend ?? 0, currency))}</span></span>`;
    tooltip.hidden = false;
  }

  /** @param {number} clientX */
  function indexFromClientX(clientX) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    const ctm = svg.getScreenCTM();
    if (!ctm) return 0;
    const cur = pt.matrixTransform(ctm.inverse());
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - cur.x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function onPointer(ev) {
    if (!(ev instanceof PointerEvent)) return;
    const r = plot.getBoundingClientRect();
    if (
      ev.clientX < r.left ||
      ev.clientX > r.right ||
      ev.clientY < r.top ||
      ev.clientY > r.bottom
    ) {
      hideTooltip();
      return;
    }
    const idx = indexFromClientX(ev.clientX);
    showTooltip(idx);
    requestAnimationFrame(() => {
      const tipR = tooltip.getBoundingClientRect();
      let left = ev.clientX - r.left - tipR.width / 2;
      left = Math.max(8, Math.min(left, r.width - tipR.width - 8));
      let top = ev.clientY - r.top - tipR.height - 12;
      if (top < 8) top = ev.clientY - r.top + 16;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });
  }

  plot.addEventListener("pointermove", onPointer);
  plot.addEventListener("pointerleave", hideTooltip);
  plot.addEventListener("pointerdown", onPointer);
}

/**
 * @param {number} v
 */
function formatAxisMoney(v) {
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v / 50) * 50);
}

/**
 * @param {number} v
 */
function formatMoney(v, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(v);
}

/** @param {string | undefined} iso */
function formatShortDate(iso) {
  if (!iso) return "";
  const d = iso.slice(5, 10);
  return d.replace("-", "/");
}

/** @param {string | undefined} iso */
function formatLongDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} s */
function escapeSvgText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
