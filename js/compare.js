/* =====================================================================
 * compare.js
 * ---------------------------------------------------------------------
 * Layer : Visualization & Result Display (algorithm comparison)
 *
 * Runs every algorithm (1, 2 and, in Stage 3, the research-based 3) to completion on identical inputs and shows the performance
 * parameters side by side, plus a sweep that repeats the comparison
 * while one input is varied.
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

PCSim.Compare = (function () {
  var $ = function (id) { return document.getElementById(id); };
  // Algorithms in table order; 3a and 3 need a buffer, so they are skipped when unbuffered.
  var ALGOS = ['semaphore', 'busywait', 'faa'];
  var ALGO_COLOR = { semaphore: '#2a3784', busywait: '#d0611f', faa: '#1e8a6c' };
  var ALGO_TAG = { semaphore: 'Alg 1', busywait: 'Alg 2', faa: 'Alg 3' };
  var ALGO_HEAD = { semaphore: 'Alg 1: Semaphore', busywait: 'Alg 2: Busy-wait', faa: 'Alg 3: F&A ring' };

  /* Rows of the results table: key, label, which direction is better, decimals. */
  var ROWS = [
    { key: 'makespan',       label: 'Makespan',               unit: 'ticks',      better: 'low',  d: 0 },
    { key: 'throughput',     label: 'Throughput',             unit: 'items/100 ticks', better: 'high', d: 2 },
    { key: 'avgWait',        label: 'Average waiting time',   unit: 'ticks',      better: 'low',  d: 2 },
    { key: 'maxWait',        label: 'Maximum waiting time',   unit: 'ticks',      better: 'low',  d: 0 },
    { key: 'bufferUtil',     label: 'Buffer utilization',     unit: '%',          better: 'none', d: 1 },
    { key: 'cpuEfficiency',  label: 'CPU efficiency',         unit: '% useful',   better: 'high', d: 1 },
    { key: 'wastedCpu',      label: 'Wasted CPU (spinning)',  unit: 'ticks',      better: 'low',  d: 0 },
    { key: 'switchOverhead', label: 'Context-switch overhead', unit: 'ticks',     better: 'low',  d: 0 },
    { key: 'blockCalls',     label: 'Times a thread blocked', unit: 'sleeps',     better: 'low',  d: 0 },
    { key: 'syncPerItem',    label: 'Synchronization ticks',  unit: 'per item',   better: 'low',  d: 2 },
    { key: 'fairness',       label: "Fairness (Jain's index)", unit: '0 - 1',     better: 'high', d: 3 }
  ];

  function algosFor(cfg) {
    return ALGOS.filter(function (a) { return !(PCSim.needsBuffer(a) && cfg.bufferType === PCSim.BUFFER.UNBUFFERED); });
  }

  /* Run one algorithm to completion and return its metrics. */
  function runOne(cfg, algorithm) {
    var c = {};
    Object.keys(cfg).forEach(function (k) { c[k] = cfg[k]; });
    c.algorithm = algorithm;
    c.reversedWait = false;        // the comparison always uses the correct wait() order
    var m = new PCSim.Simulation(c).runToEnd();
    m.syncPerItem = m.syncCalls / m.totalItems;
    return m;
  }

  /* @returns {algos: [...], semaphore: metrics, busywait: metrics, ...} */
  function run(cfg) {
    var res = { algos: algosFor(cfg) };
    res.algos.forEach(function (a) { res[a] = runOne(cfg, a); });
    return res;
  }

  function configChips(cfg) {
    var parts = [
      cfg.bufferType === 'bounded' || !cfg.bufferType ? 'N = ' + cfg.bufferSize : PCSim.BUFFER_SHORT[cfg.bufferType] + ' buffer', cfg.producers + ' producer(s)', cfg.consumers + ' consumer(s)',
      cfg.itemsPerProducer + ' items each', 'produce ' + cfg.produceTime + ' / consume ' + cfg.consumeTime + ' ticks',
      cfg.cores + ' core(s)', 'switch cost ' + cfg.switchCost,
      cfg.scheduler === 'random' ? 'random scheduler (seed ' + cfg.seed + ')' : 'round-robin scheduler'
    ];
    $('cmp-config').innerHTML = parts.map(function (p) { return '<span>' + p + '</span>'; }).join('');
  }

  /* ================================================================
   * Stage 3: buffered vs non-buffered
   * The same workload is run with the three buffer models.
   * ============================================================== */
  var BUF_TYPES = ['unbuffered', 'bounded', 'unbounded'];
  var BUF_COLOR = { unbuffered: '#b9468f', bounded: '#2a3784', unbounded: '#23977a' };
  var BUF_ROWS = [
    { key: 'makespan',        label: 'Makespan',                  unit: 'ticks',           better: 'low',  d: 0 },
    { key: 'throughput',      label: 'Throughput',                unit: 'items/100 ticks', better: 'high', d: 2 },
    { key: 'prodWaitPerItem', label: 'Producer wait per item',    unit: 'ticks',           better: 'low',  d: 2 },
    { key: 'consWaitPerItem', label: 'Consumer wait per item',    unit: 'ticks',           better: 'low',  d: 2 },
    { key: 'avgWait',         label: 'Average waiting time',      unit: 'ticks / wait',    better: 'low',  d: 2 },
    { key: 'peakOccupancy',   label: 'Peak items in buffer',      unit: 'memory',          better: 'low',  d: 0 },
    { key: 'avgOccupancy',    label: 'Average items in buffer',   unit: 'items',           better: 'none', d: 2 },
    { key: 'cpuEfficiency',   label: 'CPU efficiency',            unit: '% useful',        better: 'high', d: 1 },
    { key: 'wastedCpu',       label: 'Wasted CPU (spinning)',     unit: 'ticks',           better: 'low',  d: 0 },
    { key: 'switchOverhead',  label: 'Context-switch overhead',   unit: 'ticks',           better: 'low',  d: 0 },
    { key: 'blockCalls',      label: 'Times a thread blocked',    unit: 'sleeps',          better: 'low',  d: 0 },
    { key: 'fairness',        label: "Fairness (Jain's index)",   unit: '0 - 1',           better: 'high', d: 3 }
  ];

  function runBuffers(cfg, algorithm) {
    var out = {};
    BUF_TYPES.forEach(function (bt) {
      var c = {};
      Object.keys(cfg).forEach(function (k) { c[k] = cfg[k]; });
      c.algorithm = algorithm || PCSim.ALGO.SEMAPHORE;
      c.bufferType = bt;
      c.reversedWait = false;
      out[bt] = new PCSim.Simulation(c).runToEnd();
    });
    return out;
  }

  function bufferChips(cfg) {
    var parts = [
      'bounded N = ' + cfg.bufferSize, cfg.producers + ' producer(s)', cfg.consumers + ' consumer(s)',
      cfg.itemsPerProducer + ' items each', 'produce ' + cfg.produceTime + ' / consume ' + cfg.consumeTime + ' ticks',
      cfg.cores + ' core(s)', 'switch cost ' + cfg.switchCost,
      cfg.scheduler === 'random' ? 'random scheduler (seed ' + cfg.seed + ')' : 'round-robin scheduler'
    ];
    $('buf-config').innerHTML = parts.map(function (p) { return '<span>' + p + '</span>'; }).join('');
  }

  function renderBufferTable(res, cfg) {
    var head = { unbuffered: 'Unbuffered (0)', bounded: 'Bounded (N = ' + cfg.bufferSize + ')', unbounded: 'Unbounded (&infin;)' };
    var html = '<table class="cmp-table buf-table"><thead><tr><th>Parameter</th>' +
      BUF_TYPES.map(function (bt) { return '<th>' + head[bt] + '</th>'; }).join('') + '<th>Best</th></tr></thead><tbody>';
    html += '<tr><td>Result</td>' + BUF_TYPES.map(function (bt) {
      return '<td class="' + (res[bt].integrityOk ? 'win' : '') + '">' + (res[bt].integrityOk ? 'Correct' : res[bt].status) + '</td>';
    }).join('') + '<td>-</td></tr>';
    BUF_ROWS.forEach(function (r) {
      var vals = BUF_TYPES.map(function (bt) { return res[bt][r.key]; });
      var shown = vals.map(function (v) { return v.toFixed(r.d); });
      var best = null;
      if (r.better !== 'none') {
        var target = r.better === 'low' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
        var winners = BUF_TYPES.filter(function (bt, i) { return shown[i] === target.toFixed(r.d); });
        best = winners.length === BUF_TYPES.length ? 'tie' : winners;
      }
      html += '<tr><td>' + r.label + '<span class="hint">' + r.unit + '</span></td>' +
        BUF_TYPES.map(function (bt, i) {
          return '<td class="mono ' + (best && best !== 'tie' && best.indexOf(bt) >= 0 ? 'win' : '') + '">' + shown[i] + '</td>';
        }).join('') +
        '<td>' + (best === null ? 'n/a' : best === 'tie' ? 'tie' : best.map(function (bt) { return PCSim.BUFFER_SHORT[bt]; }).join(', ')) + '</td></tr>';
    });
    $('buf-table').innerHTML = html + '</tbody></table>';
  }

  function renderBufferBars(res) {
    var picks = [
      ['makespan', 'Makespan', 'ticks, lower is better', 0],
      ['prodWaitPerItem', 'Producer wait / item', 'ticks, lower is better', 2],
      ['peakOccupancy', 'Peak items in buffer', 'memory, lower is better', 0],
      ['throughput', 'Throughput', 'per 100 ticks, higher is better', 2],
      ['cpuEfficiency', 'CPU efficiency', '%, higher is better', 1],
      ['blockCalls', 'Times blocked', 'sleeps (Alg 1)', 0]
    ];
    var host = $('buf-bars');
    host.innerHTML = picks.map(function (p, i) {
      return '<div class="bar-card"><h4>' + p[1] + ' <small>' + p[2] + '</small></h4><div id="bbar-' + i + '"></div></div>';
    }).join('');
    picks.forEach(function (p, i) {
      PCSim.Charts.barPair($('bbar-' + i), BUF_TYPES.map(function (bt) {
        return { label: PCSim.BUFFER_SHORT[bt], value: res[bt][p[0]], color: BUF_COLOR[bt], text: res[bt][p[0]].toFixed(p[3]) };
      }));
    });
  }

  function bufferSweep(cfg, algorithm, param, metric) {
    var f = PCSim.FIELDS[param], rows = [];
    for (var v = f.min; v <= f.max; v++) {
      var c = {};
      Object.keys(cfg).forEach(function (k) { c[k] = cfg[k]; });
      c[param] = v;
      var r = runBuffers(c, algorithm), row = { x: v, ok: true };
      BUF_TYPES.forEach(function (bt) { row[bt] = r[bt][metric]; row.ok = row.ok && r[bt].integrityOk; });
      rows.push(row);
    }
    return rows;
  }

  function renderBufferSweep(cfg, algorithm, param, metric) {
    var rows = bufferSweep(cfg, algorithm, param, metric);
    PCSim.Charts.line($('bsweep-chart'), BUF_TYPES.map(function (bt) {
      return { name: PCSim.BUFFER_SHORT[bt], color: BUF_COLOR[bt], points: rows.map(function (r) { return [r.x, r[bt]]; }) };
    }), { xLabel: PCSim.FIELDS[param].label, markers: true, labelEnds: true, integerX: true });
    var label = { makespan: 'Makespan', prodWaitPerItem: 'Producer wait per item', peakOccupancy: 'Peak items in buffer', throughput: 'Throughput' }[metric];
    var avg = function (bt) { return rows.reduce(function (a, r) { return a + r[bt]; }, 0) / rows.length; };
    $('bsweep-note').innerHTML = label + ' while ' + PCSim.FIELDS[param].label + ' goes from ' + rows[0].x + ' to ' + rows[rows.length - 1].x +
      ' (' + PCSim.ALGO_SHORT[algorithm] + '). Average: ' +
      BUF_TYPES.map(function (bt) { return '<b style="color:' + BUF_COLOR[bt] + '">' + PCSim.BUFFER_SHORT[bt] + ' ' + avg(bt).toFixed(2) + '</b>'; }).join(', ') +
      '. All ' + rows.length * 3 + ' runs ' + (rows.every(function (r) { return r.ok; }) ? 'passed' : 'did NOT all pass') + ' the integrity check.' +
      (param === 'bufferSize' ? ' (N only changes the bounded buffer; the other two lines stay flat.)' : '');
    return rows;
  }

  /* Winning algorithm(s) for one row, compared at the displayed precision. */
  function winners(algos, vals, r) {
    if (r.better === 'none' || vals.some(function (v) { return v === null; })) return null;
    var shown = vals.map(function (v) { return v.toFixed(r.d); });
    var target = (r.better === 'low' ? Math.min : Math.max).apply(null, vals).toFixed(r.d);
    var w = algos.filter(function (a, i) { return shown[i] === target; });
    return w.length === algos.length ? 'tie' : w;
  }

  function renderTable(res) {
    var algos = res.algos;
    var html = '<table class="cmp-table"><thead><tr><th>Parameter</th>' +
      algos.map(function (a) { return '<th class="h-' + a + '">' + ALGO_HEAD[a] + '</th>'; }).join('') + '<th class="h-best">Best</th></tr></thead><tbody>';
    html += '<tr><td>Result</td>' + algos.map(function (a) {
      return '<td class="' + (res[a].integrityOk ? 'win' : '') + '">' + (res[a].integrityOk ? 'Correct' : res[a].status) + '</td>';
    }).join('') + '<td>-</td></tr>';
    ROWS.forEach(function (r) {
      var vals = algos.map(function (a) { return res[a][r.key]; });
      var best = winners(algos, vals, r);
      html += '<tr><td>' + r.label + '<span class="hint">' + r.unit + '</span></td>' +
        algos.map(function (a, i) {
          var v = vals[i];
          return '<td class="mono ' + (best && best !== 'tie' && best.indexOf(a) >= 0 ? 'win' : '') + '">' + (v === null ? 'n/a' : v.toFixed(r.d)) + '</td>';
        }).join('') +
        '<td>' + (best === null ? 'n/a' : best === 'tie' ? 'tie' : best.map(function (a) { return ALGO_TAG[a]; }).join(', ')) + '</td></tr>';
    });
    $('cmp-table').innerHTML = html + '</tbody></table>';
  }

  function renderBars(res) {
    var picks = [
      ['makespan', 'Makespan', 'ticks, lower is better', 0],
      ['avgWait', 'Avg waiting time', 'ticks, lower is better', 1],
      ['switchOverhead', 'Context switches', 'ticks, lower is better', 0],
      ['cpuEfficiency', 'CPU efficiency', '%, higher is better', 1],
      ['wastedCpu', 'Wasted CPU', 'ticks spinning', 0],
      ['syncPerItem', 'Sync ticks / item', 'lower is better', 2]
    ];
    var host = $('cmp-bars');
    host.innerHTML = picks.map(function (p, i) {
      return '<div class="bar-card"><h4>' + p[1] + ' <small>' + p[2] + '</small></h4><div id="bar-' + i + '"></div></div>';
    }).join('');
    picks.forEach(function (p, i) {
      PCSim.Charts.barPair($('bar-' + i), res.algos.map(function (a) {
        return { label: ALGO_TAG[a], value: res[a][p[0]], color: ALGO_COLOR[a], text: res[a][p[0]].toFixed(p[3]) };
      }));
    });
  }

  /**
   * Repeat the comparison while varying one parameter.
   * @returns {Array} rows [{x, ok, semaphore, busywait, ...}]
   */
  function sweep(cfg, param, metric) {
    var f = PCSim.FIELDS[param], rows = [];
    for (var v = f.min; v <= f.max; v++) {
      var c = {};
      Object.keys(cfg).forEach(function (k) { c[k] = cfg[k]; });
      c[param] = v;
      var r = run(c), row = { x: v, ok: true };
      r.algos.forEach(function (a) { row[a] = r[a][metric]; row.ok = row.ok && r[a].integrityOk; });
      rows.push(row);
    }
    return rows;
  }

  function renderSweep(cfg, param, metric) {
    var rows = sweep(cfg, param, metric), algos = algosFor(cfg);
    var label = { makespan: 'Makespan (ticks)', throughput: 'Throughput', avgWait: 'Average waiting time', cpuEfficiency: 'CPU efficiency (%)' }[metric];
    PCSim.Charts.line($('sweep-chart'), algos.map(function (a) {
      return { name: ALGO_TAG[a], color: ALGO_COLOR[a], points: rows.map(function (r) { return [r.x, r[a]]; }) };
    }), { xLabel: PCSim.FIELDS[param].label, markers: true, labelEnds: true, xTicks: rows.length - 1, integerX: true });

    var lowerBetter = metric === 'makespan' || metric === 'avgWait';
    var wins = {};
    algos.forEach(function (a) { wins[a] = 0; });
    rows.forEach(function (r) {
      var best = (lowerBetter ? Math.min : Math.max).apply(null, algos.map(function (a) { return r[a]; }));
      algos.forEach(function (a) { if (r[a] === best) wins[a]++; });
    });
    $('sweep-note').innerHTML = label + ' for ' + PCSim.FIELDS[param].label + ' = ' + rows[0].x + ' to ' + rows[rows.length - 1].x +
      '. Best (or tied best) at: ' + algos.map(function (a) {
        return '<b style="color:' + ALGO_COLOR[a] + '">' + ALGO_TAG[a] + ' ' + wins[a] + '</b>';
      }).join(', ') + ' of ' + rows.length + ' points. ' +
      'All ' + rows.length * algos.length + ' runs ' + (rows.every(function (r) { return r.ok; }) ? 'passed' : 'did NOT all pass') + ' the integrity check.';
    return rows;
  }

  return { run: run, renderTable: renderTable, renderBars: renderBars, renderSweep: renderSweep, configChips: configChips, sweep: sweep, ROWS: ROWS,
           runBuffers: runBuffers, bufferChips: bufferChips, renderBufferTable: renderBufferTable, renderBufferBars: renderBufferBars,
           bufferSweep: bufferSweep, renderBufferSweep: renderBufferSweep, BUF_TYPES: BUF_TYPES, BUF_ROWS: BUF_ROWS };
})();
