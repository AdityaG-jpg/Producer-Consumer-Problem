/* =====================================================================
 * charts.js
 * ---------------------------------------------------------------------
 * Layer : Visualization & Result Display
 * Tiny dependency-free SVG chart helpers (line chart + bar pair), so
 * the simulator keeps working offline without any chart library.
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

PCSim.Charts = (function () {
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* Pick a "nice" axis maximum and tick step for a value. */
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  function fmt(v) {
    if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(Math.round(v));
    return v.toFixed(1);
  }

  /**
   * Line chart.
   * @param {HTMLElement} host
   * @param {Array} series  [{name, color, points: [[x, y], ...], step: bool, fill: bool}]
   * @param {object} opt    {xLabel, yLabel, yMax, xMin, xMax, markers, hLine: {y, color, label}}
   */
  function line(host, series, opt) {
    opt = opt || {};
    var W = host.clientWidth || 600, H = host.clientHeight || 200;
    var m = { l: 42, r: 12, t: 10, b: opt.xLabel ? 32 : 20 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
    var all = [];
    series.forEach(function (s) { all = all.concat(s.points); });
    var xs = all.map(function (p) { return p[0]; });
    var xMin = opt.xMin !== undefined ? opt.xMin : (xs.length ? Math.min.apply(null, xs) : 0);
    var xMax = opt.xMax !== undefined ? opt.xMax : (xs.length ? Math.max.apply(null, xs) : 1);
    if (xMax === xMin) xMax = xMin + 1;
    var yMax = opt.yMax || niceMax(Math.max.apply(null, all.map(function (p) { return p[1]; }).concat([1])) * 1.08);
    var pad = opt.markers ? 0.04 : 0;              // keep end markers away from the frame
    var X = function (x) { return m.l + (pad + (1 - 2 * pad) * (x - xMin) / (xMax - xMin)) * (W - m.l - m.r); };
    var Y = function (y) { return H - m.b - y / yMax * (H - m.t - m.b); };

    // grid + y axis labels
    var yStep = opt.integerY ? Math.max(1, Math.ceil(yMax / 5)) : yMax / 4;
    for (var yv = 0; yv <= yMax + 1e-9; yv += yStep) {
      var yy = Y(yv);
      svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: '#e6e9f2', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: m.l - 6, y: yy + 3.5, 'text-anchor': 'end', 'font-size': 10, fill: '#8a90aa' }, fmt(yv)));
    }
    // x axis labels
    var xt = opt.xTicks || 6;
    var xVals = [];
    if (opt.integerX) {
      // integer axis: label every 1, 2, 5, 10, 20, 25, 50 ... so that at most ~10 labels appear
      var stepX = 1, nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
      for (var ni = 0; ni < nice.length; ni++) { stepX = nice[ni]; if ((xMax - xMin) / stepX <= 10) break; }
      for (var xi = Math.ceil(xMin / stepX) * stepX; xi <= xMax; xi += stepX) xVals.push(xi);
    } else for (var k = 0; k <= xt; k++) xVals.push(xMin + (xMax - xMin) * k / xt);
    for (var k2 = 0; k2 < xVals.length; k2++) {
      var xv = xVals[k2];
      svg.appendChild(el('text', { x: X(xv), y: H - m.b + 13, 'text-anchor': 'middle', 'font-size': 10, fill: '#8a90aa' }, fmt(xv)));
    }
    if (opt.xLabel) svg.appendChild(el('text', { x: (m.l + W - m.r) / 2, y: H - 3, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#5d6385', 'font-weight': 600 }, opt.xLabel));

    if (opt.hLine) {
      var hy = Y(opt.hLine.y);
      svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: hy, y2: hy, stroke: opt.hLine.color, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    }

    series.forEach(function (s) {
      if (!s.points.length) return;
      var d = '';
      s.points.forEach(function (p, idx) {
        if (idx === 0) d += 'M' + X(p[0]) + ' ' + Y(p[1]);
        else if (s.step) d += ' H' + X(p[0]) + ' V' + Y(p[1]);
        else d += ' L' + X(p[0]) + ' ' + Y(p[1]);
      });
      if (s.fill) {
        var last = s.points[s.points.length - 1], first = s.points[0];
        svg.appendChild(el('path', { d: d + ' V' + Y(0) + ' H' + X(first[0]) + ' Z', fill: s.color, opacity: 0.12 }));
      }
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round' }));
      if (opt.markers) {
        s.points.forEach(function (p) {
          svg.appendChild(el('circle', { cx: X(p[0]), cy: Y(p[1]), r: 3.5, fill: '#fff', stroke: s.color, 'stroke-width': 2 }));
        });
      }
      if (s.name && opt.labelEnds) {
        var lp = s.points[s.points.length - 1];
        svg.appendChild(el('text', { x: X(lp[0]) - 4, y: Y(lp[1]) - 8, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 700, fill: s.color }, s.name));
      }
    });

    host.innerHTML = '';
    host.appendChild(svg);
  }

  /**
   * Horizontal bars for one metric (Alg 1 vs Alg 2, or the three buffer types).
   * @param {HTMLElement} host
   * @param {Array} bars [{label, value, color, text}]
   */
  function barPair(host, bars) {
    var labelW = bars.length > 2 ? 74 : 52, valueW = 54, bh = bars.length > 2 ? 22 : 26, gap = bars.length > 2 ? 10 : 18, top = 14;
    var W = host.clientWidth || 260, H = Math.max(110, top * 2 + bars.length * (bh + gap) - gap);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', style: 'height:' + H + 'px' });
    var max = Math.max.apply(null, bars.map(function (b) { return b.value; }).concat([1e-9]));
    bars.forEach(function (b, i) {
      var y = top + i * (bh + gap);
      var w = Math.max(2, (W - labelW - valueW) * (b.value / max));
      svg.appendChild(el('text', { x: 0, y: y + bh / 2 + 4, 'font-size': 11, 'font-weight': 700, fill: b.color }, b.label));
      svg.appendChild(el('rect', { x: labelW, y: y, width: W - labelW - valueW, height: bh, rx: 5, fill: '#f0f2f8' }));
      svg.appendChild(el('rect', { x: labelW, y: y, width: w, height: bh, rx: 5, fill: b.color }));
      svg.appendChild(el('text', { x: W - valueW + 6, y: y + bh / 2 + 4, 'font-size': 12, 'font-weight': 700, fill: '#1b2045' }, b.text));
    });
    host.innerHTML = '';
    host.appendChild(svg);
  }

  return { line: line, barPair: barPair };
})();
