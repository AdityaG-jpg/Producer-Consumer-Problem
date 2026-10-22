/* =====================================================================
 * programs.js
 * ---------------------------------------------------------------------
 * Layer : Producer Thread Module | Consumer Thread Module
 *
 * Every algorithm is written as a small "program": an ordered list of
 * instructions. Each instruction has
 *   code : the pseudocode line shown in the GUI code panel
 *   kind : 'compute' | 'entry' | 'critical' | 'exit'
 *          (entry = trying to get access, used to measure waiting time)
 *   exec : function(thread, sim) executed atomically in one CPU tick.
 *          It returns one of the STEP results below.
 *
 * Because one instruction = one atomic tick, the scheduler can
 * interleave threads between ANY two lines - which is exactly what
 * exposes the race condition when synchronization is missing.
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

PCSim.STEP = {
  ADVANCE: 'advance',   // instruction finished, move to the next line
  STAY:    'stay',      // useful work done but instruction not finished (e.g. produce_item still running)
  SPIN:    'spin',      // busy-wait check failed: CPU tick burnt, no progress
  BLOCK:   'block',     // thread went to sleep on a semaphore
  JUMP:    'jump'       // thread set its own pc (loop back)
};

(function () {
  var S = PCSim.STEP;

  /* ---- shared helpers ------------------------------------------- */

  // A multi-tick computation such as produce_item() or consume_item().
  function compute(t, ticks, onFinish) {
    if (t.workLeft === null) t.workLeft = ticks;
    t.workLeft--;
    if (t.workLeft > 0) return S.STAY;
    t.workLeft = null;
    if (onFinish) onFinish();
    return S.ADVANCE;
  }

  function produce(t, sim) {
    return compute(t, sim.cfg.produceTime, function () {
      t.item = sim.newItem(t);
      sim.log('produce', t.name + ' produced item ' + t.item.id, t);
    });
  }

  function consume(t, sim) {
    return compute(t, sim.cfg.consumeTime, function () {
      sim.log('consume', t.name + ' consumed item ' + (t.item ? t.item.id : '(none)'), t);
      t.item = null;
    });
  }

  /* ================================================================
   * ALGORITHM 1 : Semaphore + Mutex  (Stage 1 report, Section 4.3)
   *   producer: wait(empty) wait(mutex) insert signal(mutex) signal(full)
   *   consumer: wait(full)  wait(mutex) remove signal(mutex) signal(empty)
   * With reversed = true the two wait() calls are swapped (fault demo).
   * ============================================================== */
  function semaphoreProducer(reversed, bufferType) {
    var waitEmpty = { code: 'wait(empty);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.empty); } };
    var waitMutex = { code: 'wait(mutex);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.mutex); } };
    // Unbounded buffer: there is always space, so the producer never needs wait(empty)
    var entry = bufferType === 'unbounded' ? [waitMutex] : [reversed ? waitMutex : waitEmpty, reversed ? waitEmpty : waitMutex];
    return [{ code: 'item = produce_item();', kind: 'compute', exec: produce }].concat(entry, [
      { code: 'insert_item(item);', kind: 'critical', exec: function (t, sim) { sim.doInsert(t); return S.ADVANCE; } },
      { code: 'signal(mutex);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.mutex); } },
      { code: 'signal(full);',  kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.full); } }
    ]);
  }

  function semaphoreConsumer(reversed, bufferType) {
    var waitFull  = { code: 'wait(full);',  kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.full); } };
    var waitMutex = { code: 'wait(mutex);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.mutex); } };
    var prog = [
      reversed ? waitMutex : waitFull,
      reversed ? waitFull : waitMutex,
      { code: 'item = remove_item();', kind: 'critical', exec: function (t, sim) { sim.doRemove(t); return S.ADVANCE; } },
      { code: 'signal(mutex);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.mutex); } },
      { code: 'signal(empty);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.empty); } },
      { code: 'consume_item(item);', kind: 'compute', exec: consume }
    ];
    if (bufferType === 'unbounded') prog.splice(4, 1);   // no empty semaphore to signal
    return prog;
  }

  /* ================================================================
   * ALGORITHM 1, UNBUFFERED (zero capacity / rendezvous)
   * There is no buffer: the producer offers the item at a hand-off
   * point and must WAIT until a consumer has actually taken it.
   *   producer: wait(mutex) offer signal(full) wait(taken) signal(mutex)
   *   consumer: wait(full)  take  signal(taken)
   * mutex keeps the hand-off point to one producer at a time; full says
   * "an item is on offer"; taken says "a consumer picked it up".
   * Fault demo (reversed): the producer waits for `taken` BEFORE it
   * signals `full`, so producer and consumer wait for each other.
   * ============================================================== */
  function rendezvousProducer(reversed) {
    var sigFull   = { code: 'signal(full);    // item on offer', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.full); } };
    var waitTaken = { code: 'wait(taken);     // until picked up', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.taken); } };
    return [
      { code: 'item = produce_item();', kind: 'compute', exec: produce },
      { code: 'wait(mutex);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.mutex); } },
      { code: 'offer_item(item);', kind: 'critical', exec: function (t, sim) { sim.doInsert(t); return S.ADVANCE; } },
      reversed ? waitTaken : sigFull,
      reversed ? sigFull : waitTaken,
      { code: 'signal(mutex);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.mutex); } }
    ];
  }

  function rendezvousConsumer() {
    return [
      { code: 'wait(full);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.full); } },
      { code: 'item = take_item();', kind: 'critical', exec: function (t, sim) { sim.doRemove(t); return S.ADVANCE; } },
      { code: 'signal(taken);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.taken); } },
      { code: 'consume_item(item);', kind: 'compute', exec: consume }
    ];
  }

  /* ================================================================
   * ALGORITHM 2 : Busy waiting with a test_and_set spin-lock
   * The thread polls `count` and the lock flag in a loop, so a waiting
   * thread keeps consuming CPU ticks (the cost the WIC paper removes).
   * The re-check after taking the lock is needed because another
   * producer may have filled the last slot in between.
   * ============================================================== */
  function busyProducer(bufferType) {
    var prog = [
      { code: 'item = produce_item();', kind: 'compute', exec: produce },
      { code: 'while (count == N) ;          // spin', kind: 'entry', exec: function (t, sim) {
          return (sim.buffer.count >= sim.buffer.size) ? sim.spin(t, 'buffer full') : S.ADVANCE; } },
      { code: 'while (test_and_set(&lock)) ; // spin', kind: 'entry', exec: function (t, sim) {
          return sim.sh.lock.testAndSet(t) ? sim.spin(t, 'lock held by ' + sim.sh.lock.owner.name) : S.ADVANCE; } },
      { code: 'if (count == N) { lock = false; retry; }', kind: 'entry', exec: function (t, sim) {
          if (sim.buffer.count >= sim.buffer.size) {        // lost the race for the last slot
            sim.sh.lock.release();
            t.pc = 1;
            sim.spin(t, 'slot taken, retry');
            return S.JUMP;
          }
          return S.ADVANCE; } },
      { code: 'buffer[in] = item; in = (in+1) % N; count++;', kind: 'critical', exec: function (t, sim) {
          sim.doInsert(t); sim.buffer.count++; return S.ADVANCE; } },
      { code: 'lock = false;', kind: 'exit', exec: function (t, sim) { sim.sh.lock.release(); return S.ADVANCE; } }
    ];
    if (bufferType === 'unbounded') {      // never full: drop both "count == N" checks
      prog.splice(3, 1);
      prog.splice(1, 1);
      prog[2] = { code: 'buffer[in] = item; in++; count++;', kind: 'critical', exec: prog[2].exec };
    }
    if (bufferType === 'unbuffered') {     // one hand-off point, then wait until a consumer takes the item
      prog[1] = { code: 'while (offered) ;             // spin', kind: 'entry', exec: function (t, sim) {
          return sim.buffer.count >= 1 ? sim.spin(t, 'hand-off busy') : S.ADVANCE; } };
      prog[3] = { code: 'if (offered) { lock = false; retry; }', kind: 'entry', exec: prog[3].exec };
      prog[4] = { code: 'slot = item; offered = true;', kind: 'critical', exec: function (t, sim) {
          t.offered = t.item.id; sim.doInsert(t); sim.buffer.count++; return S.ADVANCE; } };
      prog.push({ code: 'while (slot == item) ;        // spin until taken', kind: 'entry', exec: function (t, sim) {
          var s0 = sim.buffer.slots[0];
          return (s0 && s0.valid && s0.item.id === t.offered) ? sim.spin(t, 'waiting for pickup') : S.ADVANCE; } });
    }
    return prog;
  }

  function busyConsumer(bufferType) {
    var prog = [
      { code: 'while (count == 0) ;          // spin', kind: 'entry', exec: function (t, sim) {
          return (sim.buffer.count <= 0) ? sim.spin(t, 'buffer empty') : S.ADVANCE; } },
      { code: 'while (test_and_set(&lock)) ; // spin', kind: 'entry', exec: function (t, sim) {
          return sim.sh.lock.testAndSet(t) ? sim.spin(t, 'lock held by ' + sim.sh.lock.owner.name) : S.ADVANCE; } },
      { code: 'if (count == 0) { lock = false; retry; }', kind: 'entry', exec: function (t, sim) {
          if (sim.buffer.count <= 0) {
            sim.sh.lock.release();
            t.pc = 0;
            sim.spin(t, 'item taken, retry');
            return S.JUMP;
          }
          return S.ADVANCE; } },
      { code: 'item = buffer[out]; out = (out+1) % N; count--;', kind: 'critical', exec: function (t, sim) {
          sim.doRemove(t); sim.buffer.count--; return S.ADVANCE; } },
      { code: 'lock = false;', kind: 'exit', exec: function (t, sim) { sim.sh.lock.release(); return S.ADVANCE; } },
      { code: 'consume_item(item);', kind: 'compute', exec: consume }
    ];
    if (bufferType === 'unbuffered') {
      prog[0] = { code: 'while (!offered) ;            // spin', kind: 'entry', exec: prog[0].exec };
      prog[2] = { code: 'if (!offered) { lock = false; retry; }', kind: 'entry', exec: prog[2].exec };
      prog[3] = { code: 'item = slot; offered = false;', kind: 'critical', exec: prog[3].exec };
    } else if (bufferType === 'unbounded') {
      prog[3] = { code: 'item = buffer[out]; out++; count--;', kind: 'critical', exec: prog[3].exec };
    }
    return prog;
  }

  /* ================================================================
   * ALGORITHM 3 : lock-free ring buffer, slots claimed with fetch-and-add
   * (Morrison & Afek, PPoPP 2013; waiting still sleeps, as in WIC)
   *   producer: wait(empty)  s = F&A(tail) % N   write buf[s]   signal(full)
   *   consumer: wait(full)   s = F&A(head) % N   read  buf[s]   signal(empty)
   * There is NO mutex. Each thread owns the slot its ticket points to; the
   * write/read line waits on that slot's ready flag (spins on its own slot).
   * faaCost = ticks the F&A instruction takes (default 1).
   * ============================================================== */
  function faaClaimIns(which) {
    return { code: 's = F&A(&' + which + ') % N;', kind: 'entry', exec: function (t, sim) {
      var k = sim.cfg.faaCost || 1;
      if (k > 1) {
        if (t.workLeft === null) t.workLeft = k;
        t.workLeft--;
        if (t.workLeft > 0) return S.STAY;
        t.workLeft = null;
      }
      return sim.faaClaim(t, which); } };
  }

  function faaProducer(bufferType) {
    var prog = [
      { code: 'item = produce_item();', kind: 'compute', exec: produce },
      { code: 'wait(empty);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.empty); } },
      faaClaimIns('tail'),
      { code: 'while (used[s]) ; buf[s] = item; used[s] = 1;', kind: 'entry', exec: function (t, sim) { return sim.faaWrite(t); } },
      { code: 'signal(full);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.full); } }
    ];
    if (bufferType === 'unbounded') prog.splice(1, 1);   // always space: no wait(empty)
    return prog;
  }

  function faaConsumer(bufferType) {
    var prog = [
      { code: 'wait(full);', kind: 'entry', exec: function (t, sim) { return sim.semWait(t, sim.sh.full); } },
      faaClaimIns('head'),
      { code: 'while (!used[s]) ; item = buf[s]; used[s] = 0;', kind: 'entry', exec: function (t, sim) { return sim.faaRead(t); } },
      { code: 'signal(empty);', kind: 'exit', exec: function (t, sim) { return sim.semSignal(t, sim.sh.empty); } },
      { code: 'consume_item(item);', kind: 'compute', exec: consume }
    ];
    if (bufferType === 'unbounded') prog.splice(3, 1);   // no empty semaphore to signal
    return prog;
  }

  /* ================================================================
   * DEMO : No synchronization (Stage 1 report, Section 4.2)
   * count++ is split into load/add and store, and the slot write is
   * separate from the index update, so two threads can interleave.
   * ============================================================== */
  function unsafeProducer(bufferType) {
    var prog = [
      { code: 'item = produce_item();', kind: 'compute', exec: produce },
      { code: 'while (count == N) ;          // spin', kind: 'entry', exec: function (t, sim) {
          return (sim.buffer.count >= sim.buffer.size) ? sim.spin(t, 'buffer full') : S.ADVANCE; } },
      { code: 'buffer[in] = item;', kind: 'critical', exec: function (t, sim) {
          sim.doUnsafeWrite(t); return S.ADVANCE; } },
      { code: 'in = (in + 1) % N;', kind: 'exit', exec: function (t, sim) {
          sim.buffer.in = (sim.buffer.in + 1) % sim.buffer.size; return S.ADVANCE; } },
      { code: 'reg = count; reg = reg + 1;   // load + add', kind: 'exit', exec: function (t, sim) {
          sim.unsafeLoad(t, +1); return S.ADVANCE; } },
      { code: 'count = reg;                  // store', kind: 'exit', exec: function (t, sim) {
          sim.unsafeStore(t); return S.ADVANCE; } }
    ];
    if (bufferType === 'unbounded') {
      prog.splice(1, 1);                   // never full, so no check
      prog[2] = { code: 'in = in + 1;', kind: 'exit', exec: prog[2].exec };
    }
    return prog;
  }

  function unsafeConsumer(bufferType) {
    var prog = [
      { code: 'while (count == 0) ;          // spin', kind: 'entry', exec: function (t, sim) {
          return (sim.buffer.count <= 0) ? sim.spin(t, 'buffer empty') : S.ADVANCE; } },
      { code: 'item = buffer[out];', kind: 'critical', exec: function (t, sim) {
          sim.doUnsafeRead(t); return S.ADVANCE; } },
      { code: 'out = (out + 1) % N;', kind: 'exit', exec: function (t, sim) {
          sim.buffer.out = (sim.buffer.out + 1) % sim.buffer.size; return S.ADVANCE; } },
      { code: 'reg = count; reg = reg - 1;   // load + sub', kind: 'exit', exec: function (t, sim) {
          sim.unsafeLoad(t, -1); return S.ADVANCE; } },
      { code: 'count = reg;                  // store', kind: 'exit', exec: function (t, sim) {
          sim.unsafeStore(t); return S.ADVANCE; } },
      { code: 'consume_item(item);', kind: 'compute', exec: consume }
    ];
    if (bufferType === 'unbounded') prog[2] = { code: 'out = out + 1;', kind: 'exit', exec: prog[2].exec };
    return prog;
  }

  /**
   * Return the instruction list for a role under the chosen algorithm.
   * @param {string} algorithm  one of PCSim.ALGO
   * @param {string} role       'producer' | 'consumer'
   * @param {boolean} reversed  swap the two wait() calls (Algorithm 1 only)
   * @param {string} bufferType 'bounded' (default) | 'unbuffered' | 'unbounded'
   */
  PCSim.buildProgram = function (algorithm, role, reversed, bufferType) {
    var A = PCSim.ALGO;
    bufferType = bufferType || 'bounded';
    if (algorithm === A.BUSY_WAIT) return role === 'producer' ? busyProducer(bufferType) : busyConsumer(bufferType);
    if (algorithm === A.NO_SYNC)   return role === 'producer' ? unsafeProducer(bufferType) : unsafeConsumer(bufferType);
    if (PCSim.isFaa(algorithm))    return role === 'producer' ? faaProducer(bufferType) : faaConsumer(bufferType);
    if (bufferType === 'unbuffered') return role === 'producer' ? rendezvousProducer(reversed) : rendezvousConsumer();
    return role === 'producer' ? semaphoreProducer(reversed, bufferType) : semaphoreConsumer(reversed, bufferType);
  };
})();
