/* =====================================================================
 * metrics.js
 * ---------------------------------------------------------------------
 * Layer : Visualization & Result Display (performance parameters)
 *
 * Performance parameters (Stage 1 Section 4.6, extended in Stage 2):
 *   Makespan            total ticks until the run ended
 *   Throughput          items consumed per 100 ticks
 *   Avg / Max wait      ticks between requesting the buffer and entering
 *                       the critical section (blocked + spinning + queued)
 *   Buffer utilization  mean occupancy / N over the whole run
 *   CPU efficiency      useful ticks / (cores x makespan)
 *   Wasted CPU          ticks burnt busy-waiting
 *   Switch overhead     ticks spent on context switches after wake-ups
 *   Fairness            Jain's index over per-thread mean waiting times
 *                       J = (sum x)^2 / (n * sum x^2), 1.0 = perfectly even
 *   Peak occupancy      most items held at once = memory needed (Stage 3)
 *   Wait per item       producer / consumer waiting ticks per item (Stage 3,
 *                       shows the cost of having little or no buffer)
 *   Integrity           every item consumed exactly once, in FIFO order
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

/* Jain's fairness index; returns 1 when all values are equal (incl. all zero). */
PCSim.jainIndex = function (values) {
  if (!values.length) return 1;
  var sum = 0, sumSq = 0;
  values.forEach(function (v) { sum += v; sumSq += v * v; });
  if (sumSq === 0) return 1;
  return (sum * sum) / (values.length * sumSq);
};

PCSim.computeMetrics = function (sim) {
  var ticks = Math.max(sim.tick, 1);
  var buf = sim.buffer;
  var allWaits = [];
  sim.threads.forEach(function (t) { allWaits = allWaits.concat(t.waits); });

  var occSum = sim.history.slice(1).reduce(function (a, b) { return a + b; }, 0);
  var peak = Math.max.apply(null, sim.history.concat([0]));
  var consumed = buf.stats.removed;

  // FIFO check: items must leave the buffer in the order they entered it
  var fifoOk = true;
  for (var i = 0; i < buf.removeOrder.length; i++) {
    if (buf.removeOrder[i] !== buf.insertOrder[i]) { fifoOk = false; break; }
  }

  var problems = [];
  if (buf.stats.overwritten) problems.push(buf.stats.overwritten + ' item(s) overwritten/lost');
  if (buf.stats.duplicate) problems.push(buf.stats.duplicate + ' duplicate read(s)');
  if (buf.stats.garbage) problems.push(buf.stats.garbage + ' garbage read(s)');
  if (sim.lostUpdates) problems.push(sim.lostUpdates + ' lost update(s) on count');
  if (sim.status === 'completed' && consumed !== sim.totalItems) problems.push('only ' + consumed + ' of ' + sim.totalItems + ' items consumed correctly');
  if (!fifoOk) problems.push('FIFO order broken');
  if (sim.status === 'deadlock') problems.push('deadlock');
  if (sim.status === 'stuck') problems.push('livelock');

  var producers = sim.threads.filter(function (t) { return t.role === 'producer'; });
  var consumers = sim.threads.filter(function (t) { return t.role === 'consumer'; });

  var sems = ['mutex', 'empty', 'full', 'taken'].filter(function (k) { return sim.sh[k]; });

  return {
    algorithm: sim.cfg.algorithm,
    bufferType: sim.bufferType,
    capacity: sim.bufferType === PCSim.BUFFER.UNBOUNDED ? Infinity : sim.capacity,
    status: sim.status,
    makespan: sim.tick,
    produced: sim.itemsCreated,
    consumed: consumed,
    totalItems: sim.totalItems,
    throughput: consumed / ticks * 100,
    avgWait: allWaits.length ? allWaits.reduce(function (a, b) { return a + b; }, 0) / allWaits.length : 0,
    maxWait: allWaits.length ? Math.max.apply(null, allWaits) : 0,
    avgProducerWait: avgOf(producers),
    avgConsumerWait: avgOf(consumers),
    // utilization of a buffer with no size limit is not defined, so it is reported as null
    bufferUtil: sim.bufferType === PCSim.BUFFER.UNBOUNDED ? null : occSum / (ticks * buf.size) * 100,
    avgOccupancy: occSum / ticks,
    peakOccupancy: peak,
    prodWaitPerItem: sumOf(producers) / Math.max(1, sim.totalItems),
    consWaitPerItem: sumOf(consumers) / Math.max(1, sim.totalItems),
    cpuEfficiency: sim.cpu.useful / (ticks * sim.cfg.cores) * 100,
    wastedCpu: sim.cpu.spin,
    switchOverhead: sim.cpu.switch,
    idleCpu: sim.cpu.idle,
    fairness: PCSim.jainIndex(sim.threads.map(function (t) { return t.meanWait(); })),
    blockCalls: sems.reduce(function (a, k) { return a + sim.sh[k].blockCount; }, 0),
    syncCalls: sim.threads.reduce(function (a, t) { return a + t.syncCalls; }, 0),
    lost: buf.stats.overwritten,
    duplicates: buf.stats.duplicate,
    garbage: buf.stats.garbage,
    lostUpdates: sim.lostUpdates,
    fifoOk: fifoOk,
    integrityOk: problems.length === 0 && sim.status === 'completed',
    integrityProblems: problems,
    perThread: sim.threads.map(function (t) {
      return { name: t.name, role: t.role, items: t.itemsDone, meanWait: t.meanWait(), maxWait: t.maxWait(),
               useful: t.cpuUseful, spin: t.cpuSpin, sw: t.cpuSwitch, blocked: t.blockedTicks, finish: t.finishTick };
    })
  };

  function sumOf(list) {
    return list.reduce(function (a, t) { return a + t.totalWait(); }, 0);
  }

  function avgOf(list) {
    var w = [];
    list.forEach(function (t) { w = w.concat(t.waits); });
    return w.length ? w.reduce(function (a, b) { return a + b; }, 0) / w.length : 0;
  }
};
