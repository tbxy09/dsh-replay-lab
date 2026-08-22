import type { DashboardPayload } from './dashboard-payload.ts'

export const DASHBOARD_CSP = "default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; img-src data:; media-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
export const DASHBOARD_SANDBOX = 'allow-scripts'

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
}

export function assembleDashboardDocument(payload: DashboardPayload, fragment: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${DASHBOARD_CSP}"><style>
html,body{margin:0;background:#fff;color:#1b2433;font:400 12px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
</style></head><body>
<script type="application/json" id="evidence-data">${jsonForScript(payload)}</script>
<script>window.__EVIDENCE__=JSON.parse(document.getElementById("evidence-data").textContent);</script>
${fragment}
</body></html>`
}

/** Deterministic host visualization. Model-generated fragments replace this string, not the payload. */
export const DEFAULT_DASHBOARD_FRAGMENT = `<style>
.db{display:grid;grid-template-columns:minmax(240px,280px) minmax(0,1fr);gap:14px;padding:10px 14px 12px}
.db h1{margin:0 0 4px;font-size:12px}
.db p,.db small{margin:0;color:#667085}
.legend{display:flex;flex-wrap:wrap;gap:8px 12px;grid-column:1/-1}
.legend span{display:flex;align-items:center;gap:6px;font-size:10px}
.legend i{width:8px;height:8px;border-radius:1px}
svg{display:block;margin:0 auto}
.rows{display:flex;flex-direction:column;gap:9px}
.row b{display:block;margin-bottom:4px;font-size:10px;font-weight:650}
.group{display:flex;flex-direction:column;gap:3px}
.group>div{display:grid;grid-template-columns:minmax(0,1fr) 52px;gap:6px;align-items:center}
.bar{height:7px;overflow:hidden;border-radius:2px;background:#edf0f5}
.bar>i{display:block;height:100%}
.group small{overflow:hidden;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.group>div[data-active] small{color:#1d4ed8;font-weight:700}
@media(max-width:640px){.db{grid-template-columns:1fr}}
</style>
<div class="db">
  <div class="legend" id="legend"></div>
  <div>
    <h1>Observed execution profile</h1>
    <p>Not a capability score. Saved runs highlights the selected series.</p>
    <svg id="radar" viewBox="0 0 260 260" width="260" height="220" aria-label="All retained runs execution radar"></svg>
  </div>
  <div>
    <h1>All retained runs</h1>
    <p id="meta"></p>
    <div class="rows" id="rows"></div>
  </div>
</div>
<script>
(function () {
  var evidence = window.__EVIDENCE__;
  var runs = (evidence.runs && evidence.runs.length) ? evidence.runs : [evidence.baseline, evidence.candidate];
  var activeId = evidence.activeRunId;
  var keys = ["freshInputTokens","outputTokens","cacheReadTokens","durationMs","stepCount","toolCalls"];
  var labels = { freshInputTokens:"Input", outputTokens:"Output", cacheReadTokens:"Cache", durationMs:"Duration", stepCount:"Steps", toolCalls:"Tools" };
  var palette = ["#344054","#245fda","#d97706","#7c3aed","#0f766e","#be123c"];
  var svg = document.getElementById("radar");
  var list = document.getElementById("rows");
  var legend = document.getElementById("legend");
  var meta = document.getElementById("meta");
  var candidateCount = runs.filter(function (run) { return run.kind === "candidate"; }).length;
  meta.textContent = candidateCount + " saved " + (candidateCount === 1 ? "run" : "runs") + " · turn " + evidence.turn;
  function fmt(n) { return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("en-US") : String(n); }
  function color(index) { return palette[index % palette.length]; }
  runs.forEach(function (run, index) {
    var item = document.createElement("span");
    if (run.id === activeId) item.setAttribute("data-active", "");
    item.innerHTML = "<i></i>";
    item.querySelector("i").style.background = color(index);
    item.appendChild(document.createTextNode(run.label));
    legend.appendChild(item);
  });
  var cx = 130, cy = 130, radius = 68, count = keys.length;
  function pt(i, ratio) {
    var angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return [cx + radius * ratio * Math.cos(angle), cy + radius * ratio * Math.sin(angle)];
  }
  function ring(ratio, stroke) {
    var d = keys.map(function (_, i) { var p = pt(i, ratio); return (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ") + " Z";
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", "1");
    svg.appendChild(path);
  }
  ring(0.5, "#e9edf3");
  ring(1, "#d9dee8");
  keys.forEach(function (_, i) {
    var p = pt(i, 1.38);
    var label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", p[0].toFixed(1));
    label.setAttribute("y", p[1].toFixed(1));
    label.setAttribute("text-anchor", p[0] < cx - 8 ? "end" : p[0] > cx + 8 ? "start" : "middle");
    label.setAttribute("dominant-baseline", p[1] < cy ? "auto" : "hanging");
    label.setAttribute("font-size", "9");
    label.setAttribute("fill", "#667085");
    label.textContent = labels[keys[i]];
    svg.appendChild(label);
  });
  function maxima() {
    var max = {};
    keys.forEach(function (key) {
      max[key] = Math.max.apply(null, runs.map(function (run) { return (run.metrics && run.metrics[key]) || 0; }).concat([1]));
    });
    return max;
  }
  var max = maxima();
  runs.forEach(function (run, index) {
    if (!run.metrics) return;
    var active = run.id === activeId;
    var d = keys.map(function (key, i) {
      var p = pt(i, Math.max(0, run.metrics[key]) / max[key]);
      return (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    }).join(" ") + " Z";
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", active ? color(index) + "2e" : "transparent");
    path.setAttribute("stroke", color(index));
    path.setAttribute("stroke-width", active ? "2.2" : "1.2");
    path.setAttribute("stroke-opacity", active ? "1" : "0.45");
    svg.appendChild(path);
  });
  keys.forEach(function (key) {
    var item = document.createElement("div");
    item.className = "row";
    item.innerHTML = "<b></b><div class=group></div>";
    item.querySelector("b").textContent = labels[key];
    var group = item.querySelector(".group");
    runs.forEach(function (run, index) {
      var value = (run.metrics && run.metrics[key]) || 0;
      var line = document.createElement("div");
      if (run.id === activeId) line.setAttribute("data-active", "");
      line.innerHTML = '<span class="bar"><i></i></span><small></small>';
      line.querySelector("i").style.width = Math.max(value > 0 ? 2 : 0, Math.round((value / max[key]) * 100)) + "%";
      line.querySelector("i").style.background = color(index);
      line.querySelector("i").style.opacity = run.id === activeId ? "1" : "0.45";
      line.querySelector("small").textContent = fmt(value);
      group.appendChild(line);
    });
    list.appendChild(item);
  });
})();
</script>`
