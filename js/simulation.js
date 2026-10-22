/* =====================================================================
 * simulation.js
 * ---------------------------------------------------------------------
 * Layer : Buffer Simulation Engine + CPU scheduler (Stage 3)
 *
 * Discrete-time simulation. Time advances in TICKS. In every tick the
 * scheduler picks up to `cores` runnable threads and each one executes
 * exactly ONE instruction of its program (one atomic step).
 *
 *   - A thread blocked on a semaphore is never scheduled (sleeping).
 *   - A busy-waiting thread IS scheduled and burns the tick (spinning).
 *   - A woken thread first pays `switchCost` ticks of context switch.
 *
 * Three buffer models are supported (cfg.bufferType):
 *   bounded    : N slots, semaphores mutex / empty / full
 *   unbounded  : no limit, semaphores mutex / full (no empty needed)
 *   unbuffered : zero capacity, one hand-off point guarded by
 *                mutex / full / taken (producer waits for pickup)
 *
 * After every tick the engine checks for completion, deadlock (no
 * runnable thread left but work remaining) and livelock (threads keep
 * running but nothing has progressed for STUCK_LIMIT ticks).
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

PCSim.STUCK_LIMIT = 200;     // ticks without progress before declaring a livelock
PCSim.MAX_TICKS = 20000;     // hard safety limit for any single run
PCSim.MAX_LOG = 3000;        // events kept in memory

/* Small seeded pseudo-random generator (mulberry32) so random runs are reproducible. */
PCSim.makeRng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * @param {object} cfg validated configuration (see config.js)
 */
PCSim.Simulation = function (cfg) {
  var self = this;
  var S = PCSim.STEP;
  this.cfg = cfg;
  this.tick = 0;
  this.status = 'ready';         // ready | running | paused | completed | deadlock | stuck | limit
  this.outcome = '';             // human-readable final message
  this.totalItems = cfg.producers * cfg.itemsPerProducer;
  this.bufferType = cfg.bufferType || PCSim.BUFFER.BOUNDED;
  // Capacity of the shared store: N slots, one hand-off point, or room for every item (= no limit in practice)
  this.capacity = this.bufferType === PCSim.BUFFER.UNBUFFERED ? 1 :
                  this.bufferType === PCSim.BUFFER.UNBOUNDED ? this.totalItems : cfg.bufferSize;
  this.buffer = new PCSim.BoundedBuffer(this.capacity);
  this.buffer.kind = this.bufferType;
  this.claimed = 0;              // items already claimed by consumers (termination bookkeeping)
  this.itemsCreated = 0;
  this.lostUpdates = 0;          // count = reg overwrote someone else's update (no-sync demo)
  this.rrPointer = 0;
  this.rng = PCSim.makeRng(cfg.seed);
  this.events = [];
  this.history = [];             // buffer occupancy after every tick
  this.cpu = { useful: 0, spin: 0, switch: 0, idle: 0 };
  this.lastProgressTick = 0;
  this.ranThisTick = [];

  // Shared synchronization objects for the selected algorithm
  this.sh = {};
  if (cfg.algorithm === PCSim.ALGO.SEMAPHORE) {
    this.sh.mutex = new PCSim.Semaphore('mutex', 1, 'binary');
    if (this.bufferType === PCSim.BUFFER.BOUNDED) this.sh.empty = new PCSim.Semaphore('empty', cfg.bufferSize, 'counting');
    this.sh.full  = new PCSim.Semaphore('full', 0, this.bufferType === PCSim.BUFFER.UNBUFFERED ? 'binary' : 'counting');
    if (this.bufferType === PCSim.BUFFER.UNBUFFERED) this.sh.taken = new PCSim.Semaphore('taken', 0, 'binary');
  } else if (cfg.algorithm === PCSim.ALGO.BUSY_WAIT) {
    this.sh.lock = new PCSim.SpinLock();
  } else if (PCSim.isFaa(cfg.algorithm)) {
    // Algorithm 3: no mutex. empty/full still make waiting threads sleep; the two
    // F&A counters hand out slot numbers (tickets) and are only touched by one F&A instruction.
    if (this.bufferType === PCSim.BUFFER.BOUNDED) this.sh.empty = new PCSim.Semaphore('empty', cfg.bufferSize, 'counting');
    this.sh.full = new PCSim.Semaphore('full', 0, 'counting');
    this.sh.faa = { tail: 0, head: 0 };
  }

  // Create producer and consumer threads
  this.threads = [];
  for (var i = 1; i <= cfg.producers; i++) {
    this.threads.push(new PCSim.SimThread('producer', i, PCSim.buildProgram(cfg.algorithm, 'producer', cfg.reversedWait, this.bufferType)));
  }
  for (var j = 1; j <= cfg.consumers; j++) {
    this.threads.push(new PCSim.SimThread('consumer', j, PCSim.buildProgram(cfg.algorithm, 'consumer', cfg.reversedWait, this.bufferType)));
  }

  var bufText = this.bufferType === PCSim.BUFFER.BOUNDED ? 'bounded buffer N = ' + cfg.bufferSize :
                this.bufferType === PCSim.BUFFER.UNBOUNDED ? 'unbounded buffer' : 'unbuffered (zero capacity)';
  this.log('info', 'Simulation initialised: ' + PCSim.ALGO_LABEL[cfg.algorithm] + ', ' + bufText +
           ', ' + cfg.producers + ' producer(s), ' + cfg.consumers + ' consumer(s), ' + this.totalItems + ' items in total.');
  if (this.sh.mutex || this.sh.faa) {
    var sems = ['mutex', 'empty', 'full', 'taken'].filter(function (k) { return self.sh[k]; })
      .map(function (k) { return k + ' = ' + self.sh[k].value; });
    this.log('info', 'Semaphores: ' + sems.join(', '));
  }
  this.history.push(0);
};

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */
PCSim.Simulation.prototype.log = function (type, msg, thread) {
  this.events.push({ tick: this.tick, type: type, msg: msg, thread: thread ? thread.name : '' });
  if (this.events.length > PCSim.MAX_LOG) this.events.shift();
};

PCSim.Simulation.prototype.isFinished = function () {
  return ['completed', 'deadlock', 'stuck', 'limit'].indexOf(this.status) >= 0;
};

/* ------------------------------------------------------------------ */
/* Operations called by the instruction programs (programs.js)         */
/* ------------------------------------------------------------------ */
PCSim.Simulation.prototype.newItem = function (t) {
  t.seq++;
  this.itemsCreated++;
  return { id: t.name + '-' + t.seq, producer: t.name, seq: t.seq, created: this.tick };
};

/* wait() on a semaphore: proceed, or block the thread. */
PCSim.Simulation.prototype.semWait = function (t, sem) {
  if (sem.wait(t)) {
    if (sem === this.sh.mutex) sem.holder = t;
    this.log('wait', t.name + ': wait(' + sem.name + ') succeeded, ' + sem.name + ' = ' + sem.value, t);
    return PCSim.STEP.ADVANCE;
  }
  t.state = 'blocked';
  t.blockedOn = sem;
  var unbuf = this.bufferType === PCSim.BUFFER.UNBUFFERED;
  var why = sem.name === 'empty' ? 'buffer full' :
            sem.name === 'full' ? (unbuf ? 'no item on offer' : 'buffer empty') :
            sem.name === 'taken' ? 'waiting for a consumer to take ' + (this.buffer.slots[0] && this.buffer.slots[0].valid ? this.buffer.slots[0].item.id : 'the item') :
            'mutex held by ' + (this.sh.mutex.holder ? this.sh.mutex.holder.name : '?');
  this.log('block', t.name + ' BLOCKED on wait(' + sem.name + ') - ' + why, t);
  return PCSim.STEP.BLOCK;
};

/* signal() on a semaphore: wake the first waiter or increment the value. */
PCSim.Simulation.prototype.semSignal = function (t, sem) {
  var woken = sem.signal();
  if (sem === this.sh.mutex) sem.holder = woken || null;
  if (woken) {
    woken.blockedOn = null;
    woken.pc++;                                   // its wait() has now completed
    woken.blockedSince = null;
    if (this.cfg.switchCost > 0) { woken.state = 'waking'; woken.switchLeft = this.cfg.switchCost; }
    else woken.state = 'ready';
    this.log('wake', t.name + ': signal(' + sem.name + ') wakes ' + woken.name, t);
  } else {
    this.log('signal', t.name + ': signal(' + sem.name + '), ' + sem.name + ' = ' + sem.value, t);
  }
  return PCSim.STEP.ADVANCE;
};

/* ------------------------------------------------------------------ */
/* Algorithm 3: lock-free ring buffer with fetch-and-add slot claiming */
/*   claim : one atomic F&A hands out the next ticket; the slot is      */
/*           ticket mod N, so two threads can never get the same slot.  */
/*   write / read : the thread waits on its OWN slot's ready flag       */
/*           (it can still be in use, or not yet written), so a         */
/*           consumer never reads a half-written slot.                  */
/* ------------------------------------------------------------------ */
PCSim.Simulation.prototype.faaClaim = function (t, which) {
  var c = this.sh.faa;
  t.ticket = c[which]++;
  t.slotIdx = t.ticket % this.buffer.size;
  this.log('claim', t.name + ': F&A(' + which + ') = ' + t.ticket + ' -> slot ' + t.slotIdx, t);
  return PCSim.STEP.ADVANCE;
};

PCSim.Simulation.prototype.faaWrite = function (t) {
  var s = this.buffer.slots[t.slotIdx];
  if (s && s.valid) return this.spin(t, 'slot ' + t.slotIdx + ' still in use');
  var r = this.buffer.writeSlot(t.slotIdx, t.item, t.ticket);
  t.itemsDone++;
  this.log('insert', t.name + ' wrote ' + t.item.id + ' into slot ' + t.slotIdx + ' (ticket ' + t.ticket + ')', t);
  if (r) this.log('error', 'ERROR: item ' + r.id + ' in slot ' + t.slotIdx + ' was overwritten', t);
  t.item = null;
  return PCSim.STEP.ADVANCE;
};

PCSim.Simulation.prototype.faaRead = function (t) {
  var s = this.buffer.slots[t.slotIdx];
  if (!(s && s.valid)) return this.spin(t, 'slot ' + t.slotIdx + ' not written yet');
  var r = this.buffer.readSlot(t.slotIdx, t.ticket);
  t.item = r.item;
  t.itemsDone++;
  this.log('remove', t.name + ' read ' + r.item.id + ' from slot ' + t.slotIdx + ' (ticket ' + t.ticket + ')', t);
  return PCSim.STEP.ADVANCE;
};

/* Busy-wait iteration that failed: CPU tick wasted. */
PCSim.Simulation.prototype.spin = function (t, reason) {
  if (t.state !== 'spinning' || t.spinReason !== reason) {
    this.log('spin', t.name + ' busy-waiting (' + reason + ')', t);
  }
  t.state = 'spinning';
  t.spinReason = reason;
  t.cpuSpin++;
  this.cpu.spin++;
  return PCSim.STEP.SPIN;
};

/* Protected insert / remove (Algorithm 1 and 2). */
PCSim.Simulation.prototype.doInsert = function (t) {
  var r = this.buffer.insert(t.item);
  t.itemsDone++;
  this.log('insert', this.bufferType === PCSim.BUFFER.UNBUFFERED
    ? t.name + ' offers ' + t.item.id + ' at the hand-off point'
    : t.name + ' inserted ' + t.item.id + ' into slot ' + r.index, t);
  if (r.lost) this.log('error', 'ERROR: item ' + r.lost.id + ' in slot ' + r.index + ' was overwritten', t);
  t.item = null;
};

PCSim.Simulation.prototype.doRemove = function (t) {
  var r = this.buffer.remove();
  t.item = r.item;
  t.itemsDone++;
  if (r.status === 'ok') this.log('remove', this.bufferType === PCSim.BUFFER.UNBUFFERED
    ? t.name + ' took ' + r.item.id + ' directly from ' + r.item.producer
    : t.name + ' removed ' + r.item.id + ' from slot ' + r.index, t);
  else this.log('error', 'ERROR: ' + t.name + ' read a ' + r.status + ' slot ' + r.index, t);
};

/* Unprotected operations for the no-synchronization demo. */
PCSim.Simulation.prototype.doUnsafeWrite = function (t) {
  var idx = this.buffer.in;
  var lost = this.buffer.writeSlot(idx, t.item);
  t.itemsDone++;
  this.log('insert', t.name + ' wrote ' + t.item.id + ' into slot ' + idx, t);
  if (lost) this.log('error', 'RACE: ' + t.name + ' overwrote unconsumed item ' + lost.id + ' in slot ' + idx + ' (item lost)', t);
  t.item = null;
};

PCSim.Simulation.prototype.doUnsafeRead = function (t) {
  var idx = this.buffer.out;
  var r = this.buffer.readSlot(idx);
  t.item = r.item;
  t.itemsDone++;
  if (r.status === 'ok') this.log('remove', t.name + ' read ' + r.item.id + ' from slot ' + idx, t);
  else if (r.status === 'duplicate') this.log('error', 'RACE: ' + t.name + ' consumed ' + r.item.id + ' a second time (slot ' + idx + ')', t);
  else this.log('error', 'RACE: ' + t.name + ' read garbage from never-written slot ' + idx, t);
};

PCSim.Simulation.prototype.unsafeLoad = function (t, delta) {
  t.loadedCount = this.buffer.count;          // value seen when the register was loaded
  t.reg = this.buffer.count + delta;
};

PCSim.Simulation.prototype.unsafeStore = function (t) {
  if (this.buffer.count !== t.loadedCount) {  // someone changed count in between -> their update is lost
    this.lostUpdates++;
    this.log('error', 'RACE: lost update on count - ' + t.name + ' loaded ' + t.loadedCount +
             ' but count is now ' + this.buffer.count + '; storing ' + t.reg, t);
  }
  this.buffer.count = t.reg;
};

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

/* Consumers with no item left to claim finish without using the CPU. */
PCSim.Simulation.prototype.retireIdleConsumers = function () {
  var self = this;
  this.threads.forEach(function (t) {
    if (t.role === 'consumer' && t.state !== 'done' && t.state !== 'blocked' &&
        t.pc === 0 && !t.inIteration && t.state !== 'waking' && self.claimed >= self.totalItems) {
      self.finishThread(t);
    }
  });
};

/* Choose up to `cores` runnable threads for this tick. */
PCSim.Simulation.prototype.pickThreads = function () {
  var n = this.threads.length, picked = [], i;
  if (this.cfg.scheduler === 'random') {
    var pool = this.threads.filter(function (t) { return t.isRunnable(); });
    for (i = pool.length - 1; i > 0; i--) {                    // Fisher-Yates shuffle
      var j = Math.floor(this.rng() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, this.cfg.cores);
  }
  // Round robin: continue from where the previous tick stopped
  var start = this.rrPointer;
  for (var k = 0; k < n && picked.length < this.cfg.cores; k++) {
    var idx = (start + k) % n;
    if (this.threads[idx].isRunnable()) {
      picked.push(this.threads[idx]);
      this.rrPointer = (idx + 1) % n;
    }
  }
  return picked;
};

/* Execute one instruction of thread t. */
PCSim.Simulation.prototype.execute = function (t) {
  var S = PCSim.STEP;

  // A woken thread first pays the context-switch cost
  if (t.state === 'waking' && t.switchLeft > 0) {
    t.switchLeft--;
    t.cpuSwitch++;
    this.cpu.switch++;
    this.lastProgressTick = this.tick;
    if (t.switchLeft === 0) t.state = 'ready';
    return;
  }

  // A consumer claims one of the remaining items before starting an iteration
  if (t.role === 'consumer' && t.pc === 0 && !t.inIteration) {
    if (this.claimed >= this.totalItems) { this.finishThread(t); return; }
    this.claimed++;
    t.inIteration = true;
  }

  var ins = t.program[t.pc];
  if (ins.kind === 'entry' && t.waitStart === null) { t.waitStart = this.tick; t.entryTicks = 0; }
  if (ins.kind !== 'entry' && t.waitStart !== null) {
    // waiting time = ticks between asking for the buffer and getting it,
    // minus the ticks spent actually executing the entry instructions
    t.waits.push(Math.max(0, this.tick - t.waitStart - t.entryTicks));
    t.waitStart = null;
  }

  var result = ins.exec(t, this);

  if (result === S.ADVANCE || result === S.STAY || result === S.BLOCK) {
    t.cpuUseful++;
    this.cpu.useful++;
    this.lastProgressTick = this.tick;
    if (ins.kind === 'entry' && result === S.ADVANCE) t.entryTicks++;
    if (ins.kind !== 'compute') t.syncCalls++;
  }
  if (result === S.ADVANCE || result === S.STAY) t.state = 'running';
  if (result === S.ADVANCE) this.advance(t);
};

/* Move to the next line; handle the end of a loop iteration. */
PCSim.Simulation.prototype.advance = function (t) {
  t.pc++;
  if (t.pc < t.program.length) return;
  t.pc = 0;
  if (t.role === 'producer') {
    if (t.itemsDone >= this.cfg.itemsPerProducer) this.finishThread(t);
  } else {
    t.inIteration = false;
  }
};

PCSim.Simulation.prototype.finishThread = function (t) {
  if (t.waitStart !== null) {                     // a wait that ended with the thread's last instruction
    t.waits.push(Math.max(0, this.tick - t.waitStart - t.entryTicks));
    t.waitStart = null;
  }
  t.state = 'done';
  t.finishTick = this.tick;
  this.log('done', t.name + ' finished (' + t.itemsDone + ' item' + (t.itemsDone === 1 ? '' : 's') + ')', t);
};

/**
 * Advance the simulation by ONE tick.
 * @returns {boolean} false if the run had already ended
 */
PCSim.Simulation.prototype.step = function () {
  if (this.isFinished()) return false;
  this.tick++;

  // threads that ran in the previous tick go back to the ready state
  this.threads.forEach(function (t) { if (t.state === 'running') t.state = 'ready'; });
  this.retireIdleConsumers();

  var picked = this.pickThreads();
  this.ranThisTick = picked.map(function (t) { return t.name; });
  for (var i = 0; i < picked.length; i++) this.execute(picked[i]);

  this.cpu.idle += this.cfg.cores - picked.length;
  this.threads.forEach(function (t) { if (t.state === 'blocked') t.blockedTicks++; });
  this.history.push(this.buffer.occupancy());
  this.retireIdleConsumers();
  this.checkEnd();
  return true;
};

/* Completion, deadlock and livelock detection. */
PCSim.Simulation.prototype.checkEnd = function () {
  var alive = this.threads.filter(function (t) { return t.state !== 'done'; });
  if (alive.length === 0) {
    this.status = 'completed';
    var m = PCSim.computeMetrics(this);
    this.outcome = m.integrityOk
      ? 'Completed in ' + this.tick + ' ticks. All ' + this.totalItems + ' items produced and consumed exactly once, in FIFO order.'
      : 'Completed in ' + this.tick + ' ticks, but the data is CORRUPTED: ' + m.integrityProblems.join('; ') + '.';
    this.log(m.integrityOk ? 'success' : 'error', this.outcome);
    return;
  }
  var runnable = alive.filter(function (t) { return t.isRunnable(); });
  if (runnable.length === 0) {
    this.status = 'deadlock';
    var mutex = this.sh.mutex;
    var parts = alive.map(function (t) {
      return t.name + ' waits on ' + (t.blockedOn ? t.blockedOn.name : '?') +
             (mutex && mutex.holder === t ? ' while HOLDING mutex' : '');
    });
    this.outcome = 'DEADLOCK at tick ' + this.tick + ': ' + parts.join('; ') + '. No thread can ever proceed.';
    this.log('deadlock', this.outcome);
    return;
  }
  if (this.tick - this.lastProgressTick >= PCSim.STUCK_LIMIT) {
    this.status = 'stuck';
    var probs = PCSim.computeMetrics(this).integrityProblems.filter(function (p) { return p !== 'livelock'; });
    this.outcome = 'LIVELOCK: threads kept spinning for ' + PCSim.STUCK_LIMIT + ' ticks with no progress (shared count = ' +
                   this.buffer.count + ', real occupancy = ' + this.buffer.occupancy() + ')' +
                   (probs.length ? '. Data corrupted: ' + probs.join('; ') : '') + '.';
    this.log('deadlock', this.outcome);
    return;
  }
  if (this.tick >= PCSim.MAX_TICKS) {
    this.status = 'limit';
    this.outcome = 'Stopped at the safety limit of ' + PCSim.MAX_TICKS + ' ticks.';
    this.log('error', this.outcome);
  }
};

/* Run to the end without the GUI (used by the comparison view and tests). */
PCSim.Simulation.prototype.runToEnd = function () {
  while (!this.isFinished()) this.step();
  return PCSim.computeMetrics(this);
};
