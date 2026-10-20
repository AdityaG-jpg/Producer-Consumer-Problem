/* =====================================================================
 * config.js
 * ---------------------------------------------------------------------
 * Producer-Consumer Synchronization Simulator (Stage 3, SLA - OS)
 * Layer : GUI Interaction Layer (input definitions + validation)
 *
 * Holds every user-tunable parameter in ONE place: its label, the
 * allowed range, the default value and a short help text. The same
 * table drives the input form, the validator and the preset loader,
 * so a range only ever has to be changed here.
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

/* Algorithm identifiers used throughout the code base. */
PCSim.ALGO = {
  SEMAPHORE: 'semaphore',   // Algorithm 1 : counting semaphores + mutex (blocking)
  BUSY_WAIT: 'busywait',    // Algorithm 2 : spin-lock + busy waiting on a shared count
  NO_SYNC:   'nosync'       // Demo        : no synchronization at all (race condition)
};

PCSim.ALGO_LABEL = {
  semaphore: 'Algorithm 1 - Semaphore + Mutex (blocking)',
  busywait:  'Algorithm 2 - Busy-Waiting Spinlock',
  nosync:    'Demo - No Synchronization (race condition)'
};

PCSim.ALGO_SHORT = {
  semaphore: 'Alg 1: Semaphore + Mutex',
  busywait:  'Alg 2: Busy-Wait Spinlock',
  nosync:    'No Sync (race demo)'
};

/* Buffer capacity models (Silberschatz, Sec 3.4 "Buffering"):
 *   unbuffered : zero capacity - the producer must wait until a consumer
 *                takes the item directly from it (rendezvous / hand-off)
 *   bounded    : N slots - the producer waits only when all N are full
 *   unbounded  : no limit - the producer never waits, memory keeps growing */
PCSim.BUFFER = {
  UNBUFFERED: 'unbuffered',
  BOUNDED:    'bounded',
  UNBOUNDED:  'unbounded'
};

PCSim.BUFFER_LABEL = {
  unbuffered: 'Unbuffered (zero capacity, rendezvous)',
  bounded:    'Bounded buffer (N slots)',
  unbounded:  'Unbounded buffer (no limit)'
};

PCSim.BUFFER_SHORT = {
  unbuffered: 'Unbuffered',
  bounded:    'Bounded',
  unbounded:  'Unbounded'
};

/* Numeric input fields: [min, max, default, label, help]. */
PCSim.FIELDS = {
  bufferSize:      { min: 1, max: 12, def: 5, label: 'Buffer size N',        help: 'Number of slots in the bounded buffer' },
  producers:       { min: 1, max: 6,  def: 2, label: 'Producers',       help: 'How many producers share the buffer' },
  consumers:       { min: 1, max: 6,  def: 2, label: 'Consumers',       help: 'How many consumers share the buffer' },
  itemsPerProducer:{ min: 1, max: 50, def: 6, label: 'Items / producer',     help: 'Each producer stops after this many items' },
  produceTime:     { min: 1, max: 10, def: 2, label: 'Produce time',   help: 'CPU ticks needed to produce one item (ticks)' },
  consumeTime:     { min: 1, max: 10, def: 3, label: 'Consume time',   help: 'CPU ticks needed to consume one item' },
  cores:           { min: 1, max: 4,  def: 1, label: 'CPU cores',              help: 'Threads that can execute in the same tick' },
  switchCost:      { min: 0, max: 5,  def: 1, label: 'Switch cost', help: 'Context-switch cost: kernel ticks to wake a thread blocked on a semaphore' },
  seed:            { min: 0, max: 99999, def: 7, label: 'Random seed',         help: 'Makes the random scheduler reproducible' }
};

/* Non-numeric defaults. */
PCSim.DEFAULTS = {
  algorithm: PCSim.ALGO.SEMAPHORE,
  bufferType: PCSim.BUFFER.BOUNDED,
  reversedWait: false,          // deadlock demo: wait(mutex) before wait(empty/full)
  scheduler: 'rr'               // 'rr' = round robin, 'random' = seeded random pick
};

/* Ready-made scenarios (several come straight from the Stage 1 test plan, Sec 7.3). */
PCSim.PRESETS = {
  balanced: {
    name: 'Balanced (default)',
    values: { algorithm: 'semaphore', bufferSize: 5, producers: 2, consumers: 2, itemsPerProducer: 6, produceTime: 2, consumeTime: 3, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  fastProducer: {
    name: 'Fast producers - buffer fills up',
    values: { algorithm: 'semaphore', bufferSize: 4, producers: 3, consumers: 1, itemsPerProducer: 5, produceTime: 1, consumeTime: 4, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  fastConsumer: {
    name: 'Fast consumers - buffer stays empty',
    values: { algorithm: 'semaphore', bufferSize: 5, producers: 1, consumers: 3, itemsPerProducer: 10, produceTime: 4, consumeTime: 1, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  edgeSize1: {
    name: 'Edge case - buffer of size 1',
    values: { algorithm: 'semaphore', bufferSize: 1, producers: 2, consumers: 2, itemsPerProducer: 4, produceTime: 1, consumeTime: 1, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  deadlock: {
    name: 'Deadlock demo - reversed wait() order',
    values: { algorithm: 'semaphore', bufferSize: 2, producers: 2, consumers: 1, itemsPerProducer: 5, produceTime: 1, consumeTime: 3, cores: 1, switchCost: 1, scheduler: 'random', seed: 276, reversedWait: true }
  },
  race: {
    name: 'Race condition demo - no synchronization',
    values: { algorithm: 'nosync', bufferSize: 4, producers: 3, consumers: 2, itemsPerProducer: 5, produceTime: 1, consumeTime: 2, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  busyWait: {
    name: 'Busy waiting - spinlock on 1 core',
    values: { algorithm: 'busywait', bufferSize: 3, producers: 2, consumers: 2, itemsPerProducer: 6, produceTime: 2, consumeTime: 3, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  multicore: {
    name: 'Multi-core, costly context switch',
    values: { algorithm: 'semaphore', bufferSize: 2, producers: 2, consumers: 2, itemsPerProducer: 8, produceTime: 1, consumeTime: 1, cores: 4, switchCost: 4, scheduler: 'rr', reversedWait: false }
  },
  /* ---- Stage 3: buffered vs non-buffered ---- */
  unbuffered: {
    name: 'Unbuffered - direct hand-off (rendezvous)',
    values: { algorithm: 'semaphore', bufferType: 'unbuffered', bufferSize: 5, producers: 2, consumers: 2, itemsPerProducer: 6, produceTime: 2, consumeTime: 3, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  unbounded: {
    name: 'Unbounded - fast producers, memory grows',
    values: { algorithm: 'semaphore', bufferType: 'unbounded', bufferSize: 5, producers: 3, consumers: 1, itemsPerProducer: 6, produceTime: 1, consumeTime: 4, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: false }
  },
  unbufferedDeadlock: {
    name: 'Unbuffered deadlock - wait(taken) before signal(full)',
    values: { algorithm: 'semaphore', bufferType: 'unbuffered', bufferSize: 5, producers: 2, consumers: 2, itemsPerProducer: 4, produceTime: 1, consumeTime: 2, cores: 1, switchCost: 1, scheduler: 'rr', reversedWait: true }
  }
};

/**
 * Validate the raw (string) values typed by the user.
 * Returns { ok, config, errors: {field: msg}, warnings: [msg] }.
 * Only whole numbers inside the allowed range are accepted; empty,
 * negative, decimal or non-numeric entries each get a clear message.
 */
PCSim.validateInputs = function (raw) {
  var errors = {}, warnings = [], cfg = {};

  Object.keys(PCSim.FIELDS).forEach(function (key) {
    var f = PCSim.FIELDS[key];
    var text = (raw[key] === undefined || raw[key] === null) ? '' : String(raw[key]).trim();

    if (key === 'seed' && raw.scheduler !== 'random') {   // seed only matters for the random scheduler
      cfg.seed = /^\d+$/.test(text) ? parseInt(text, 10) : f.def;
      return;
    }
    if (key === 'bufferSize' && raw.bufferType && raw.bufferType !== PCSim.BUFFER.BOUNDED) {
      cfg.bufferSize = /^\d+$/.test(text) ? parseInt(text, 10) : f.def;  // N only matters for a bounded buffer
      return;
    }
    if (text === '') {
      errors[key] = f.label + ' is required.';
    } else if (/^-/.test(text)) {
      errors[key] = 'Negative values are not allowed.';
    } else if (/^\d+\.\d*$/.test(text)) {
      errors[key] = 'Enter a whole number (no decimals).';
    } else if (!/^\d+$/.test(text)) {
      errors[key] = '"' + text + '" is not a number.';
    } else {
      var v = parseInt(text, 10);
      if (v < f.min || v > f.max) errors[key] = 'Must be between ' + f.min + ' and ' + f.max + '.';
      else cfg[key] = v;
    }
  });

  cfg.algorithm = PCSim.ALGO_LABEL[raw.algorithm] ? raw.algorithm : PCSim.DEFAULTS.algorithm;
  cfg.bufferType = PCSim.BUFFER_LABEL[raw.bufferType] ? raw.bufferType : PCSim.DEFAULTS.bufferType;
  cfg.scheduler = (raw.scheduler === 'random') ? 'random' : 'rr';
  if (cfg.algorithm === PCSim.ALGO.NO_SYNC && cfg.bufferType === PCSim.BUFFER.UNBUFFERED) {
    errors.bufferType = 'The race demo needs a buffer: choose Bounded or Unbounded.';
  }
  // Reversing the wait() order is only meaningful for the semaphore algorithm.
  cfg.reversedWait = !!raw.reversedWait && cfg.algorithm === PCSim.ALGO.SEMAPHORE;

  var ok = Object.keys(errors).length === 0;
  if (ok) {
    if (cfg.bufferSize === 1 && cfg.bufferType === PCSim.BUFFER.BOUNDED) warnings.push('Edge case: N = 1, so producers and consumers must strictly alternate.');
    if (cfg.cores > cfg.producers + cfg.consumers) warnings.push('More cores than threads: some cores will sit idle every tick.');
    if (cfg.reversedWait) warnings.push(cfg.bufferType === PCSim.BUFFER.UNBUFFERED
      ? 'Fault injection ON: the producer calls wait(taken) before signal(full), so producer and consumer wait for each other. A deadlock is expected.'
      : cfg.bufferType === PCSim.BUFFER.UNBOUNDED
      ? 'Fault injection ON: consumers call wait(mutex) before wait(full). A deadlock happens if a consumer takes the mutex while the buffer is empty.'
      : 'Fault injection ON: wait(mutex) is called before wait(empty)/wait(full). A deadlock is expected.');
    if (cfg.bufferType === PCSim.BUFFER.UNBUFFERED) warnings.push('Unbuffered: zero capacity, so every producer waits until a consumer takes its item (Buffer size N is ignored).');
    if (cfg.bufferType === PCSim.BUFFER.UNBOUNDED) warnings.push('Unbounded: producers never wait for space, so the buffer (memory) can grow without limit (Buffer size N is ignored).');
    if (cfg.algorithm === PCSim.ALGO.NO_SYNC) warnings.push('No synchronization: lost updates and overwritten items are expected.');
  }
  return { ok: ok, config: cfg, errors: errors, warnings: warnings };
};

/* Build a full default config object (used by tests and the comparison runner). */
PCSim.defaultConfig = function (overrides) {
  var c = {};
  Object.keys(PCSim.FIELDS).forEach(function (k) { c[k] = PCSim.FIELDS[k].def; });
  Object.keys(PCSim.DEFAULTS).forEach(function (k) { c[k] = PCSim.DEFAULTS[k]; });
  if (overrides) Object.keys(overrides).forEach(function (k) { c[k] = overrides[k]; });
  return c;
};

if (typeof module !== 'undefined') module.exports = PCSim;
