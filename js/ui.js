/* =====================================================================
 * ui.js
 * ---------------------------------------------------------------------
 * Layer : Visualization & Result Display
 *
 * Draws the current simulation state into the page. The UI only READS
 * the simulation object; it never changes semaphores or the buffer
 * directly (all changes go through Simulation.step()), which matches
 * the separation planned in Figure 3 of the Stage 1 report.
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

PCSim.UI = (function () {
  var $ = function (id) { return document.getElementById(id); };

  // One colour per producer so every item shows who made it.
  var PRODUCER_COLORS = ['#3f5bd9', '#e07a2e', '#23977a', '#b9468f', '#7f57d3', '#c99a1c'];
  var STATE_TEXT = { ready: 'Ready', running: 'Running', blocked: 'Waiting', spinning: 'Spinning', waking: 'Waking', done: 'Done' };
  var STATE_HELP = {
    ready: 'idle (ready)', running: 'running', blocked: 'waiting (asleep)',
    spinning: 'busy-waiting', waking: 'context switch', done: 'done'
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function itemColor(item) {
    var n = parseInt(String(item.producer).slice(1), 10) || 1;
    return PRODUCER_COLORS[(n - 1) % PRODUCER_COLORS.length];
  }

  function fmt(v, d) { return (v === null || v === undefined || isNaN(v)) ? '-' : Number(v).toFixed(d === undefined ? 1 : d); }

  /* ---------- legend ---------- */
  function renderLegend(algorithm) {
    var states = ['ready', 'running', algorithm === 'semaphore' ? 'blocked' : 'spinning', 'done'];
    if (algorithm === 'semaphore') states.splice(3, 0, 'waking');
    var colors = { ready: 'var(--st-ready)', running: 'var(--st-running)', blocked: 'var(--st-blocked)', spinning: 'var(--st-spinning)', waking: 'var(--st-waking)', done: 'var(--st-done)' };
    $('legend').innerHTML = states.map(function (s) {
      return '<span><i style="background:' + colors[s] + '"></i>' + STATE_HELP[s] + '</span>';
    }).join('');
  }

  /* ---------- thread cards ---------- */
  function threadCard(t, sim) {
    var ins = t.currentInstruction();
    var instr = t.state === 'done' ? 'finished' :
                t.state === 'waking' ? 'context switch (' + t.switchLeft + ' tick' + (t.switchLeft === 1 ? '' : 's') + ' left)' :
                ins ? ins.code.replace(/\s*\/\/.*$/, '') : '';
    if (t.state === 'blocked' && t.blockedOn) instr = 'asleep in wait(' + t.blockedOn.name + ')';
    var quota = t.role === 'producer' ? sim.cfg.itemsPerProducer : null;
    var pct = quota ? (t.itemsDone / quota * 100) : 0;
    var holds = (sim.sh.mutex && sim.sh.mutex.holder === t) || (sim.sh.lock && sim.sh.lock.owner === t);
    var holding = t.item ? '<span class="held item-tag" style="background:' + itemColor(t.item) + '">' + esc(t.item.id) + '</span>' : '';
    return '<div class="thread ' + t.state + '">' +
      '<div class="row1"><span class="tname">' + t.name + (holds ? ' <span class="held" title="inside critical section">&#128274;</span>' : '') + ' ' + holding + '</span>' +
      '<span class="badge">' + STATE_TEXT[t.state] + '</span></div>' +
      '<div class="instr" title="' + esc(instr) + '">' + esc(instr) + '</div>' +
      '<div class="row3"><span>' + (quota ? 'made ' + t.itemsDone + '/' + quota : (sim.cfg.algorithm === 'nosync' ? 'reads ' : 'consumed ') + t.itemsDone) + '</span>' +
      '<span>avg wait ' + fmt(t.meanWait()) + '</span></div>' +
      (quota ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') +
      '</div>';
  }

  function renderThreads(sim) {
    $('producers').innerHTML = sim.threads.filter(function (t) { return t.role === 'producer'; }).map(function (t) { return threadCard(t, sim); }).join('');
    $('consumers').innerHTML = sim.threads.filter(function (t) { return t.role === 'consumer'; }).map(function (t) { return threadCard(t, sim); }).join('');
  }

  /* ---------- buffer (bounded / unbounded / unbuffered hand-off) ---------- */
  function slotHtml(s, cls, ptr, idx, text) {
    var full = s && s.valid;
    var style = full ? 'background:' + itemColor(s.item) + ';border-color:' + itemColor(s.item) : '';
    return '<div class="slot"><div class="ptr">' + (ptr || '') + '</div>' +
           '<div class="box' + (full ? ' full' : '') + (cls ? ' ' + cls : '') + '" style="' + style + '">' + (full ? esc(s.item.id) : (text || '')) + '</div>' +
           '<div class="idx">' + idx + '</div></div>';
  }

  function renderBuffer(sim) {
    var b = sim.buffer, html = '';
    var recentError = sim.events.length && sim.events[sim.events.length - 1].type === 'error' && sim.events[sim.events.length - 1].tick === sim.tick;
    var hl = function (i) { return b.lastTouched === i && sim.tick > 0 ? (recentError ? 'corrupt' : 'touched') : ''; };
    var occ = b.occupancy();
    var kind = sim.bufferType;
    var foot;

    if (kind === 'unbuffered') {
      // zero capacity: a single hand-off point between the producer and the consumer
      var s0 = b.slots[0];
      var offering = sim.threads.filter(function (t) { return t.role === 'producer' && t.blockedOn && t.blockedOn.name === 'taken'; })
        .concat(sim.threads.filter(function (t) { return t.state === 'spinning' && t.spinReason === 'waiting for pickup'; }));
      var takers = sim.threads.filter(function (t) { return t.role === 'consumer' && t.blockedOn && t.blockedOn.name === 'full'; })
        .concat(sim.threads.filter(function (t) { return t.role === 'consumer' && t.state === 'spinning'; }));
      html = '<div class="handoff">' +
             '<div class="who">' + (offering.length ? offering.map(function (t) { return t.name; }).join(', ') + '<br>waits for pickup' : 'producer side') + '</div>' +
             '<span class="arrow">&#10140;</span>' +
             slotHtml(s0, hl(0), '', 'hand-off') +
             '<span class="arrow">&#10140;</span>' +
             '<div class="who">' + (takers.length ? takers.map(function (t) { return t.name; }).join(', ') + '<br>wait for an item' : 'consumer side') + '</div>' +
             '</div>';
      $('buffer').innerHTML = html;
      $('buffer-title-text').textContent = 'No buffer - direct hand-off';
      $('buffer-meta').textContent = '(zero capacity)';
      foot = '<span>On offer <b>' + occ + ' / 1</b></span>' +
             '<span>Handed over <b>' + b.stats.removed + '</b></span>' +
             '<span>Remaining to produce <b>' + (sim.totalItems - sim.itemsCreated) + '</b></span>';
      $('buffer-foot').innerHTML = foot;
      return;
    }

    if (kind === 'unbounded') {
      // no size limit: draw only the items that are queued, oldest (out) first
      var SHOW = 14, queued = [];
      for (var q = b.out; q < b.in; q++) if (b.slots[q] && b.slots[q].valid) queued.push(q);
      queued.slice(0, SHOW).forEach(function (i, k) {
        html += slotHtml(b.slots[i], hl(i), k === 0 ? '<span class="ptr-tag out">out</span>' : '', '[' + i + ']');
      });
      if (queued.length > SHOW) html += slotHtml(null, 'more', '', '', '+' + (queued.length - SHOW));
      html += slotHtml(null, 'grow', '<span class="ptr-tag in">in</span>', '[' + b.in + ']', '&hellip;');
      $('buffer').innerHTML = html;
      $('buffer-title-text').textContent = 'Unbounded Buffer';
      $('buffer-meta').textContent = '(N = ∞)';
      var peak = Math.max.apply(null, sim.history);
      foot = '<span>In buffer <b>' + occ + '</b></span>' +
             '<span>Peak (memory) <b>' + peak + '</b></span>' +
             '<span>Inserted <b>' + b.stats.inserted + '</b></span>' +
             '<span>Removed <b>' + b.stats.removed + '</b></span>' +
             '<span>Remaining to produce <b>' + (sim.totalItems - sim.itemsCreated) + '</b></span>';
    } else {
      for (var i = 0; i < b.size; i++) {
        var ptr = '';
        if (b.in === i) ptr += '<span class="ptr-tag in">in</span>';
        if (b.out === i) ptr += '<span class="ptr-tag out">out</span>';
        html += slotHtml(b.slots[i], hl(i), ptr, '[' + i + ']');
      }
      $('buffer').innerHTML = html;
      $('buffer-title-text').textContent = 'Bounded Buffer';
      $('buffer-meta').textContent = '(N = ' + b.size + ')';
      foot = '<span>Occupied <b>' + occ + ' / ' + b.size + '</b></span>' +
             '<span>Inserted <b>' + b.stats.inserted + '</b></span>' +
             '<span>Removed <b>' + b.stats.removed + '</b></span>' +
             '<span>Remaining to produce <b>' + (sim.totalItems - sim.itemsCreated) + '</b></span>';
    }
    if (sim.cfg.algorithm !== 'semaphore') {
      var mismatch = b.count !== occ;
      foot += '<span class="' + (mismatch ? 'bad' : '') + '">shared <code>count</code> <b class="' + (mismatch ? 'bad' : '') + '">' + b.count + '</b>' + (mismatch ? ' &ne; real ' + occ : '') + '</span>';
    }
    var meterPct = kind === 'unbounded' ? occ / sim.totalItems * 100 : occ / b.size * 100;
    $('buffer-foot').innerHTML = foot + '<div style="flex-basis:100%"><div class="occ-meter"' +
      (kind === 'unbounded' ? ' title="share of all items currently held in memory"' : '') + '><i style="width:' + meterPct + '%"></i></div></div>';
  }

  /* ---------- semaphore / lock state ---------- */
  function semBox(sem, total, note) {
    var cells = '';
    if (total) for (var i = 0; i < total; i++) cells += '<i class="' + (i < sem.value ? 'on' : '') + '"></i>';
    var q = sem.queue.map(function (t) { return '<span class="chip">' + t.name + '</span>'; }).join('');
    var holder = sem.holder ? '<span class="chip hold">' + sem.holder.name + '</span> inside critical section' : '';
    return '<div class="sem">' +
      '<div class="top"><span class="sname">' + sem.name + '<span class="stype">' + sem.kind + ' &middot; init ' + sem.initial + (note ? ' &middot; ' + note : '') + '</span></span>' +
      '<span class="sval">' + sem.value + '</span></div>' +
      (total ? '<div class="cells">' + cells + '</div>' : '') +
      '<div class="qrow">' + (holder ? holder + (q ? '&nbsp;&middot;&nbsp;' : '') : '') +
      (q ? 'queue: ' + q : (holder ? '' : '<span>no thread waiting</span>')) + '</div></div>';
  }

  function renderSync(sim) {
    var html = '';
    if (sim.cfg.algorithm === 'semaphore') {
      $('sync-title').textContent = 'Semaphore State' + (sim.cfg.reversedWait ? ' (wait order REVERSED)' : '');
      if (sim.bufferType === 'unbuffered') {
        html += semBox(sim.sh.mutex, 1, 'one producer at the hand-off');
        html += semBox(sim.sh.full, 1, 'item on offer');
        html += semBox(sim.sh.taken, 1, 'item picked up');
      } else if (sim.bufferType === 'unbounded') {
        html += semBox(sim.sh.mutex, 1, 'mutual exclusion');
        html += semBox(sim.sh.full, 0, 'filled slots');
        html += '<div class="sem"><div class="top"><span class="sname">empty<span class="stype">not needed</span></span><span class="sval">&infin;</span></div>' +
                '<div class="qrow">no size limit, so a producer never waits for space</div></div>';
      } else {
        html += semBox(sim.sh.mutex, 1, 'mutual exclusion');
        html += semBox(sim.sh.empty, sim.cfg.bufferSize, 'free slots');
        html += semBox(sim.sh.full, sim.cfg.bufferSize, 'filled slots');
      }
    } else if (sim.cfg.algorithm === 'busywait') {
      $('sync-title').textContent = 'Spinlock State';
      var lock = sim.sh.lock;
      var spinners = sim.threads.filter(function (t) { return t.state === 'spinning'; })
        .map(function (t) { return '<span class="chip spin">' + t.name + '</span>'; }).join('');
      html += '<div class="sem"><div class="top"><span class="sname">lock<span class="stype">test_and_set flag</span></span>' +
              '<span class="sval">' + (lock.locked ? 'HELD' : 'free') + '</span></div>' +
              '<div class="qrow">' + (lock.owner ? '<span class="chip hold">' + lock.owner.name + '</span> owns the lock' : 'nobody owns the lock') + '</div></div>';
      html += '<div class="sem"><div class="top"><span class="sname">' + (sim.bufferType === 'unbuffered' ? 'offered' : 'count') +
              '<span class="stype">' + (sim.bufferType === 'unbuffered' ? 'item waiting at the hand-off (0/1)' : 'shared item counter') + '</span></span>' +
              '<span class="sval">' + sim.buffer.count + '</span></div>' +
              '<div class="qrow">' + (spinners ? 'spinning now: ' + spinners : 'no thread spinning') + '</div></div>';
      html += '<div class="sem"><div class="top"><span class="sname">wasted CPU<span class="stype">ticks burnt spinning</span></span>' +
              '<span class="sval" style="color:var(--st-spinning)">' + sim.cpu.spin + '</span></div>' +
              '<div class="qrow">failed test_and_set calls: ' + lock.failedAttempts + '</div></div>';
    } else {
      $('sync-title').textContent = 'Shared State (unprotected)';
      var st = sim.buffer.stats, occ = sim.buffer.occupancy();
      var bad = sim.buffer.count !== occ;
      html += '<div class="sem ' + (bad ? 'alert' : '') + '"><div class="top"><span class="sname">count<span class="stype">real occupancy = ' + occ + '</span></span>' +
              '<span class="sval" style="' + (bad ? 'color:var(--bad)' : '') + '">' + sim.buffer.count + '</span></div>' +
              '<div class="qrow">' + (bad ? 'count is WRONG - an update was lost' : 'count matches the buffer (for now)') + '</div></div>';
      html += '<div class="sem ' + (st.overwritten ? 'alert' : '') + '"><div class="top"><span class="sname">items lost<span class="stype">overwritten before use</span></span><span class="sval">' + st.overwritten + '</span></div></div>';
      html += '<div class="sem ' + (sim.lostUpdates ? 'alert' : '') + '"><div class="top"><span class="sname">lost updates<span class="stype">count = reg overwrote</span></span><span class="sval">' + sim.lostUpdates + '</span></div></div>';
      html += '<div class="sem ' + (st.duplicate + st.garbage ? 'alert' : '') + '"><div class="top"><span class="sname">bad reads<span class="stype">duplicate / garbage</span></span><span class="sval">' + (st.duplicate + st.garbage) + '</span></div></div>';
    }
    $('sync').innerHTML = html;
  }

  /* ---------- code panel with thread markers ---------- */
  function codeBlock(title, program, threads, loopNote) {
    var html = '<div class="code-block"><div class="code-head">' + title + '</div>';
    program.forEach(function (ins, i) {
      var here = threads.filter(function (t) { return t.state !== 'done' && t.pc === i; });
      var chips = here.map(function (t) { return '<span class="chip st-' + t.state + '">' + t.name + '</span>'; }).join('');
      html += '<div class="code-line ' + (here.some(function (t) { return t.state === 'running' || t.state === 'spinning'; }) ? 'active' : '') + '">' +
              '<span class="ln">' + (i + 1) + '</span><span class="txt">' + esc(ins.code) + '</span><span class="who">' + chips + '</span></div>';
    });
    return html + '<div class="code-loop">' + loopNote + '</div></div>';
  }

  function renderCode(sim) {
    var prods = sim.threads.filter(function (t) { return t.role === 'producer'; });
    var cons = sim.threads.filter(function (t) { return t.role === 'consumer'; });
    $('code').innerHTML =
      codeBlock('producer() { while (items_left) {', prods[0].program, prods, '} }') +
      codeBlock('consumer() { while (items_left) {', cons[0].program, cons, '} }');
  }

  /* ---------- event log ---------- */
  function renderLog(sim) {
    var box = $('log');
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    var rows = sim.events.slice(-160).map(function (e) {
      return '<div class="log-row ' + e.type + '"><span class="lt">' + e.tick + '</span><span class="ld"></span><span>' + esc(e.msg) + '</span></div>';
    });
    box.innerHTML = rows.join('');
    if (nearBottom || sim.isFinished()) box.scrollTop = box.scrollHeight;
    $('log-count').textContent = '(' + sim.events.length + ' events)';
  }

  /* ---------- live metrics ---------- */
  function renderMetrics(sim) {
    var m = PCSim.computeMetrics(sim);
    var tiles = [
      { v: m.consumed + '/' + m.totalItems, l: 'Consumed' },
      { v: fmt(m.throughput, 2), l: 'Throughput' },
      { v: fmt(m.avgWait, 1), l: 'Avg wait' },
      { v: m.maxWait, l: 'Max wait' },
      sim.bufferType === 'unbounded' ? { v: m.peakOccupancy, l: 'Peak in buffer' } :
        { v: fmt(m.bufferUtil, 1) + '%', l: sim.bufferType === 'unbuffered' ? 'Hand-off busy' : 'Buffer util.' },
      { v: fmt(m.cpuEfficiency, 1) + '%', l: 'CPU useful' },
      { v: sim.cfg.algorithm === 'semaphore' ? m.switchOverhead : m.wastedCpu, l: sim.cfg.algorithm === 'semaphore' ? 'Switch ticks' : 'Wasted CPU', cls: sim.cfg.algorithm !== 'semaphore' && m.wastedCpu ? 'bad' : '' },
      { v: fmt(m.fairness, 3), l: 'Fairness' }
    ];
    if (sim.isFinished()) tiles[0].cls = m.integrityOk ? 'good' : 'bad';
    $('metrics').innerHTML = tiles.map(function (t) {
      return '<div class="metric ' + (t.cls || '') + '"><div class="mv">' + t.v + '</div><div class="ml">' + t.l + '</div></div>';
    }).join('');
    return m;
  }

  function renderChart(sim) {
    var hist = sim.history;
    var start = Math.max(0, hist.length - 400);
    var pts = [];
    for (var i = start; i < hist.length; i++) pts.push([i, hist[i]]);
    var unbounded = sim.bufferType === 'unbounded';
    var yMax = unbounded ? Math.max(4, Math.ceil(Math.max.apply(null, hist) * 1.15)) : sim.capacity;
    $('cap-key').style.display = unbounded ? 'none' : '';
    PCSim.Charts.line($('occ-chart'), [{ name: 'occupancy', color: '#2a3784', points: pts, step: true, fill: true }],
      { yMax: yMax, integerY: true, hLine: unbounded ? null : { y: sim.capacity, color: '#d23b3b' }, xMin: start, xMax: Math.max(start + 20, hist.length - 1), integerX: true });
  }

  /* ---------- status + banner ---------- */
  function renderStatus(sim, uiState) {
    $('tick').textContent = sim.tick;
    var pill = $('status-pill');
    var st = uiState || sim.status;
    var text = { ready: 'Ready', running: 'Running', paused: 'Paused', completed: 'Completed', deadlock: 'Deadlock', stuck: 'Livelock', limit: 'Stopped', corrupt: 'Corrupted', invalid: 'Fix inputs' }[st] || st;
    var m = sim.isFinished() ? PCSim.computeMetrics(sim) : null;
    if (st === 'completed' && m && !m.integrityOk) { st = 'corrupt'; text = 'Done - corrupted'; }
    pill.className = 'status-pill ' + st;
    pill.textContent = text;

    var banner = $('banner');
    if (sim.isFinished()) {
      banner.className = 'banner ' + (m.integrityOk ? 'success' : 'error');
      banner.innerHTML = (m.integrityOk ? '<b>&#10004; Correct.</b> ' : '<b>&#10008; ' + (sim.status === 'deadlock' ? 'Deadlock.' : sim.status === 'stuck' ? 'Livelock.' : 'Incorrect result.') + '</b> ') + esc(sim.outcome.replace(/^(DEADLOCK |LIVELOCK: )/, '').replace(/^./, function (c) { return c.toUpperCase(); }));
    } else {
      banner.className = 'banner hidden';
    }
  }

  function renderAll(sim, uiState) {
    renderLegend(sim.cfg.algorithm);
    renderThreads(sim);
    renderBuffer(sim);
    renderSync(sim);
    renderCode(sim);
    renderLog(sim);
    renderMetrics(sim);
    renderChart(sim);
    renderStatus(sim, uiState);
  }

  return { renderAll: renderAll, renderStatus: renderStatus, esc: esc, fmt: fmt };
})();
