/* =====================================================================
 * main.js
 * ---------------------------------------------------------------------
 * Layer : GUI Interaction Layer (controller)
 *
 * Wires the page together: builds the input form, validates every
 * change, creates a fresh Simulation for each valid configuration,
 * and drives Run / Step / Pause / Reset and the comparison tab.
 * ===================================================================== */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var FIELD_ORDER = ['bufferSize', 'producers', 'consumers', 'itemsPerProducer', 'produceTime', 'consumeTime', 'cores', 'switchCost'];

  var sim = null;            // current Simulation
  var timer = null;          // interval handle while running
  var lastValid = null;      // last validation result
  var compareDone = false;
  var bufCompareDone = false;
  var lastCmpRes = null, lastBufRes = null;   // kept so charts can be redrawn when a section is opened
  var sweepDone = false, bsweepDone = false;

  function openFold(id) { var d = $(id); if (d) d.open = true; }

  /* ---------------- build the input form ---------------- */
  function buildForm() {
    $('fields').innerHTML = FIELD_ORDER.map(function (k) { return fieldHtml(k); }).join('');
    $('seed-slot').innerHTML = fieldHtml('seed');

    var sel = $('preset');
    sel.innerHTML = '<option value="">- Custom -</option>' + Object.keys(PCSim.PRESETS).map(function (k) {
      return '<option value="' + k + '">' + PCSim.PRESETS[k].name + '</option>';
    }).join('');
    sel.value = 'balanced';
  }

  function fieldHtml(k) {
    var f = PCSim.FIELDS[k];
    return '<div class="field"><label class="field-label" for="f-' + k + '" title="' + f.help + '">' + f.label + '</label>' +
           '<input class="num" id="f-' + k + '" data-key="' + k + '" type="text" inputmode="numeric" value="' + f.def + '" ' +
           'title="' + f.help + ' (' + f.min + '-' + f.max + ')" placeholder="' + f.min + '-' + f.max + '">' +
           '<div class="field-error" id="e-' + k + '"></div></div>';
  }

  /* Read every control as raw text (validation happens in config.js). */
  function readRaw() {
    var raw = {};
    FIELD_ORDER.concat(['seed']).forEach(function (k) { raw[k] = $('f-' + k).value; });
    var algo = document.querySelector('input[name="algorithm"]:checked');
    raw.algorithm = algo ? algo.value : 'semaphore';
    var bt = document.querySelector('input[name="bufferType"]:checked');
    raw.bufferType = bt ? bt.value : 'bounded';
    raw.scheduler = $('scheduler').value;
    raw.reversedWait = $('reversedWait').checked;
    return raw;
  }

  function applyPreset(key) {
    var p = PCSim.PRESETS[key];
    if (!p) return;
    var v = p.values;
    FIELD_ORDER.forEach(function (k) { if (v[k] !== undefined) $('f-' + k).value = v[k]; });
    $('f-seed').value = v.seed !== undefined ? v.seed : PCSim.FIELDS.seed.def;
    document.querySelector('input[name="algorithm"][value="' + v.algorithm + '"]').checked = true;
    document.querySelector('input[name="bufferType"][value="' + (v.bufferType || 'bounded') + '"]').checked = true;
    $('scheduler').value = v.scheduler || 'rr';
    $('reversedWait').checked = !!v.reversedWait;
    onConfigChange(false);
  }

  /* ---------------- validation feedback ---------------- */
  function showValidation(res) {
    FIELD_ORDER.concat(['seed']).forEach(function (k) {
      var input = $('f-' + k), err = $('e-' + k);
      var msg = res.errors[k] || '';
      input.classList.toggle('invalid', !!msg);
      err.textContent = msg;
    });
    $('e-bufferType').textContent = res.errors.bufferType || '';
    // N only matters for a bounded buffer
    $('f-bufferSize').disabled = res.config.bufferType !== 'bounded';
    var isSem = res.config.algorithm === 'semaphore';
    $('reversedWait').disabled = !isSem;
    $('reversedWait').parentElement.classList.toggle('disabled', !isSem);
    $('f-seed').disabled = $('scheduler').value !== 'random';

    var box = $('form-messages'), html = '';
    var n = Object.keys(res.errors).length;
    if (n) html += '<div class="msg error"><b>' + n + ' invalid input' + (n > 1 ? 's' : '') + '.</b> Fix the highlighted field' + (n > 1 ? 's' : '') + ' to run the simulation.</div>';
    res.warnings.forEach(function (w) { html += '<div class="msg warn">' + PCSim.UI.esc(w) + '</div>'; });
    if (!n && !res.warnings.length) html += '<div class="msg ok">Inputs valid. ' + res.config.producers * res.config.itemsPerProducer + ' items will pass through the buffer.</div>';
    box.innerHTML = html;
  }

  function setControls(running) {
    var valid = lastValid && lastValid.ok;
    var finished = sim && sim.isFinished();
    $('btn-run').disabled = !valid || running || finished;
    $('btn-step').disabled = !valid || running || finished;
    $('btn-pause').disabled = !running;
    $('btn-reset').disabled = !valid;
    var inputs = document.querySelectorAll('.config-panel input, .config-panel select');
    for (var i = 0; i < inputs.length; i++) {
      if (running) inputs[i].setAttribute('disabled', 'disabled');
      else if (inputs[i].id !== 'f-seed' && inputs[i].id !== 'reversedWait' && inputs[i].id !== 'f-bufferSize') inputs[i].removeAttribute('disabled');
    }
    if (!running && lastValid) showValidation(lastValid);
  }

  /* Called whenever any input changes. */
  function onConfigChange(markCustom) {
    if (markCustom) $('preset').value = '';
    lastValid = PCSim.validateInputs(readRaw());
    showValidation(lastValid);
    if (lastValid.ok) {
      newSimulation();
    } else {
      stop();
      if (sim) PCSim.UI.renderStatus(sim, 'invalid');
      setControls(false);
    }
    if (compareDone) refreshCompareConfig();
    if (bufCompareDone && lastValid.ok) PCSim.Compare.bufferChips(lastValid.config);
  }

  /* ---------------- simulation control ---------------- */
  function newSimulation() {
    stop();
    sim = new PCSim.Simulation(lastValid.config);
    PCSim.UI.renderAll(sim, 'ready');
    setControls(false);
  }

  function stepOnce() {
    if (!sim || sim.isFinished()) return;
    sim.step();
    PCSim.UI.renderAll(sim, sim.isFinished() ? null : (timer ? 'running' : 'paused'));
    if (sim.isFinished()) { stop(); PCSim.UI.renderAll(sim); }
  }

  function run() {
    if (!sim || sim.isFinished() || timer) return;
    var speed = parseInt($('speed').value, 10);
    timer = setInterval(stepOnce, Math.max(25, Math.round(1000 / speed)));
    PCSim.UI.renderStatus(sim, 'running');
    setControls(true);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    setControls(false);
  }

  function pause() {
    stop();
    if (sim && !sim.isFinished()) PCSim.UI.renderStatus(sim, 'paused');
  }

  /* ---------------- comparison tab ---------------- */
  function refreshCompareConfig() {
    if (lastValid && lastValid.ok) PCSim.Compare.configChips(lastValid.config);
  }

  function runCompare() {
    var err = $('cmp-error');
    if (!lastValid || !lastValid.ok) {
      err.textContent = 'The inputs on the Simulator tab are invalid. Fix them before running the comparison.';
      err.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    refreshCompareConfig();
    var res = PCSim.Compare.run(lastValid.config);
    lastCmpRes = res;
    openFold('d-cmp-table');
    PCSim.Compare.renderTable(res);
    PCSim.Compare.renderBars(res);
    compareDone = true;
    return res;
  }

  function runSweep() {
    if (!lastValid || !lastValid.ok) return runCompare();
    openFold('d-cmp-sweep'); sweepDone = true;
    return PCSim.Compare.renderSweep(lastValid.config, $('sweep-param').value, $('sweep-metric').value);
  }

  /* ---------------- buffered vs unbuffered tab (Stage 3) ---------------- */
  function runBufferCompare() {
    var err = $('buf-error');
    if (!lastValid || !lastValid.ok) {
      err.textContent = 'The inputs on the Simulator tab are invalid. Fix them before running the comparison.';
      err.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    PCSim.Compare.bufferChips(lastValid.config);
    var res = PCSim.Compare.runBuffers(lastValid.config, $('buf-algo').value);
    lastBufRes = res;
    openFold('d-buf-table');
    PCSim.Compare.renderBufferTable(res, lastValid.config);
    PCSim.Compare.renderBufferBars(res);
    bufCompareDone = true;
    return res;
  }

  function runBufferSweep() {
    if (!lastValid || !lastValid.ok) return runBufferCompare();
    openFold('d-buf-sweep'); bsweepDone = true;
    return PCSim.Compare.renderBufferSweep(lastValid.config, $('buf-algo').value, $('bsweep-param').value, $('bsweep-metric').value);
  }

  function showTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    $('tab-sim').classList.toggle('active', name === 'sim');
    $('tab-compare').classList.toggle('active', name === 'compare');
    $('tab-buffers').classList.toggle('active', name === 'buffers');
    if (name === 'buffers') {
      if (lastValid && lastValid.ok) PCSim.Compare.bufferChips(lastValid.config);
      if (!bufCompareDone) {
        $('buf-table').innerHTML = '<div class="empty-note">Press <b>Run buffer comparison</b> to run the workload with no buffer, a bounded buffer and an unbounded buffer.</div>';
        $('buf-bars').innerHTML = '<div class="empty-note" style="grid-column:1/-1">Charts appear here after the comparison runs.</div>';
        $('bsweep-chart').innerHTML = '<div class="empty-note">Choose a parameter and press <b>Run sweep</b>.</div>';
      }
    } else if (name === 'compare') {
      refreshCompareConfig();
      if (!compareDone) {
        $('cmp-table').innerHTML = '<div class="empty-note">Press <b>Run comparison</b> to execute every algorithm on the current inputs.</div>';
        $('cmp-bars').innerHTML = '<div class="empty-note" style="grid-column:1/-1">Charts appear here after the comparison runs.</div>';
        $('sweep-chart').innerHTML = '<div class="empty-note">Choose a parameter and press <b>Run sweep</b>.</div>';
      }
    } else if (sim) {
      PCSim.UI.renderAll(sim, timer ? 'running' : (sim.tick && !sim.isFinished() ? 'paused' : null));
    }
  }

  /* ---------------- event wiring ---------------- */
  function wire() {
    document.querySelector('.config-panel').addEventListener('input', function (e) {
      if (e.target.id === 'preset') return;
      onConfigChange(true);
    });
    $('preset').addEventListener('change', function () { applyPreset($('preset').value); });
    $('btn-run').addEventListener('click', run);
    $('btn-step').addEventListener('click', function () { stepOnce(); if (!sim.isFinished()) PCSim.UI.renderStatus(sim, 'paused'); setControls(false); });
    $('btn-pause').addEventListener('click', pause);
    $('btn-reset').addEventListener('click', function () { if (lastValid && lastValid.ok) newSimulation(); });
    $('speed').addEventListener('input', function () {
      $('speed-val').textContent = $('speed').value + '/s';
      if (timer) { stop(); run(); }
    });
    $('btn-compare').addEventListener('click', runCompare);
    $('btn-sweep').addEventListener('click', runSweep);
    $('btn-buf-compare').addEventListener('click', runBufferCompare);
    $('btn-bsweep').addEventListener('click', runBufferSweep);
    $('buf-algo').addEventListener('change', function () { if (bufCompareDone) runBufferCompare(); });
    // Charts need a real width, so redraw them when their (initially closed) section is opened.
    $('d-perf').addEventListener('toggle', function () { if (this.open && sim) PCSim.UI.renderAll(sim, timer ? 'running' : (sim.tick && !sim.isFinished() ? 'paused' : null)); });
    $('d-cmp-charts').addEventListener('toggle', function () { if (this.open && lastCmpRes) PCSim.Compare.renderBars(lastCmpRes); });
    $('d-buf-charts').addEventListener('toggle', function () { if (this.open && lastBufRes) PCSim.Compare.renderBufferBars(lastBufRes); });
    $('d-cmp-sweep').addEventListener('toggle', function () { if (this.open && sweepDone && lastValid && lastValid.ok) runSweep(); });
    $('d-buf-sweep').addEventListener('toggle', function () { if (this.open && bsweepDone && lastValid && lastValid.ok) runBufferSweep(); });
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { showTab(this.getAttribute('data-tab')); });
    }
  }

  /**
   * Optional scenario link, e.g. index.html#preset=unbuffered&steps=40
   *   preset=<key>  load a preset        steps=<n>  run n ticks, then pause
   *   cores=4, buffer=unbounded, algorithm=busywait ...  override single inputs
   *   finish=1      run to the end       tab=compare|buffers  open a tab
   *   run=1         press the compare / buffer-compare button on that tab
   *   sweep=<param>,<metric>  run the sweep on that tab
   * Handy for the live demo and for taking the report screenshots.
   */
  function loadFromHash() {
    var h = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) h[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    if (h.preset && PCSim.PRESETS[h.preset]) window.PCSimApp.preset(h.preset);
    // any input can be overridden after the preset, e.g. #preset=balanced&cores=4
    var changed = false;
    FIELD_ORDER.concat(['seed']).forEach(function (k) { if (h[k] !== undefined) { $('f-' + k).value = h[k]; changed = true; } });
    if (h.algorithm) { document.querySelector('input[name="algorithm"][value="' + h.algorithm + '"]').checked = true; changed = true; }
    if (h.buffer) { document.querySelector('input[name="bufferType"][value="' + h.buffer + '"]').checked = true; changed = true; }
    if (changed) onConfigChange(true);
    if (h.algo) $('buf-algo').value = h.algo;
    if (h.finish) window.PCSimApp.finish();
    else if (h.steps) window.PCSimApp.steps(parseInt(h.steps, 10) || 0);
    if (h.tab) showTab(h.tab);
    if (h.tab === 'compare') {
      if (h.run) runCompare();
      if (h.sweep) { var a = h.sweep.split(','); $('sweep-param').value = a[0]; if (a[1]) $('sweep-metric').value = a[1]; runSweep(); }
    }
    if (h.tab === 'buffers') {
      if (h.run) runBufferCompare();
      if (h.sweep) { var b = h.sweep.split(','); $('bsweep-param').value = b[0]; if (b[1]) $('bsweep-metric').value = b[1]; runBufferSweep(); }
    }
  }

  buildForm();
  wire();
  applyPreset('balanced');

  // Small hook used for automated testing and the report screenshots.
  window.PCSimApp = {
    preset: function (k) { $('preset').value = k; applyPreset(k); },
    steps: function (n) { for (var i = 0; i < n && !sim.isFinished(); i++) sim.step(); PCSim.UI.renderAll(sim, sim.isFinished() ? null : 'paused'); setControls(false); },
    finish: function () { while (!sim.isFinished()) sim.step(); PCSim.UI.renderAll(sim); setControls(false); },
    sim: function () { return sim; },
    tab: showTab, compare: runCompare, sweep: runSweep,
    bufferCompare: runBufferCompare, bufferSweep: runBufferSweep
  };
  if (location.hash.length > 1) loadFromHash();
})();
