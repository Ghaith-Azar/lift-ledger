// A thin wrapper around Chart.js so views don't repeat theme setup,
// and so every chart gets destroyed when the route changes (Chart.js
// leaks canvases and keeps redrawing otherwise).

let charts = [];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function theme() {
  return {
    text: cssVar('--muted'),
    grid: cssVar('--grid'),
    font: getComputedStyle(document.body).fontFamily,
  };
}

Chart.defaults.color = theme().text;
Chart.defaults.font.family = theme().font;
Chart.defaults.borderColor = theme().grid;

export function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function baseOptions(extra = {}) {
  const t = theme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface-2'),
        titleColor: cssVar('--text'),
        bodyColor: cssVar('--text'),
        borderColor: cssVar('--line'),
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        titleFont: { weight: '700' },
      },
      ...extra.plugins,
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: t.text, font: { size: 11 } } },
      y: {
        grid: { color: t.grid },
        ticks: { color: t.text, font: { size: 11 } },
        beginAtZero: true,
        ...extra.yScale,
      },
      ...extra.scales,
    },
    ...extra.options,
  };
}

/**
 * Draw a chart into a fresh canvas appended to `host` and track it for cleanup.
 * `spec` is a Chart.js config minus sensible defaults.
 */
export function drawChart(host, spec) {
  const canvas = document.createElement('canvas');
  host.replaceChildren(canvas);
  const chart = new Chart(canvas.getContext('2d'), {
    ...spec,
    options: { ...baseOptions(spec.optionsExtra), ...spec.options },
  });
  charts.push(chart);
  return chart;
}

export const colors = () => ({
  a: cssVar('--chart-a'),
  b: cssVar('--chart-b'),
  c: cssVar('--chart-c'),
  d: cssVar('--chart-d'),
  up: cssVar('--up'),
  down: cssVar('--down'),
});
