/* =====================================================================
 * semaphore.js
 * ---------------------------------------------------------------------
 * Layer : Semaphore & Mutex Controller (Figure 3 of the Stage 1 report)
 *
 * Two synchronization primitives:
 *   1. Semaphore - classical counting/binary semaphore with a FIFO wait
 *                  queue. A blocked thread is put to sleep (it is NOT
 *                  given CPU time) until another thread signals.
 *   2. SpinLock  - test_and_set lock used by Algorithm 2. A thread that
 *                  fails to get the lock keeps the CPU busy re-trying.
 *
 * Each call to wait()/signal() is executed by the simulator as ONE
 * atomic step, which is exactly the guarantee an OS gives for P()/V().
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

/**
 * @param {string} name     display name: 'mutex', 'empty' or 'full'
 * @param {number} initial  initial value (1 for mutex, N for empty, 0 for full)
 * @param {string} kind     'binary' or 'counting' (display only)
 */
PCSim.Semaphore = function (name, initial, kind) {
  this.name = name;
  this.initial = initial;
  this.value = initial;
  this.kind = kind || 'counting';
  this.queue = [];        // threads blocked on this semaphore, FIFO order
  this.holder = null;     // for the mutex only: thread currently inside the critical section
  this.waitCalls = 0;     // statistics
  this.blockCount = 0;
};

/**
 * wait() / P(): if the value is positive, decrement it and continue;
 * otherwise the calling thread is appended to the queue and blocks.
 * @returns {boolean} true if the thread may proceed, false if it blocked
 */
PCSim.Semaphore.prototype.wait = function (thread) {
  this.waitCalls++;
  if (this.value > 0) {         // a unit is free: take it and continue
    this.value--;
    return true;
  }
  this.queue.push(thread);      // no unit free: sleep in the FIFO queue
  this.blockCount++;
  return false;
};

/**
 * signal() / V(): if some thread is blocked, hand the unit directly to
 * the first one in the queue (the value stays the same); otherwise
 * increment the value.
 * @returns {object|null} the thread that was woken up, or null
 */
PCSim.Semaphore.prototype.signal = function () {
  if (this.queue.length > 0) {
    return this.queue.shift();  // hand the unit straight to the first waiter
  }
  this.value++;
  return null;
};

/* Short text such as "empty = 3  [P1, P2 waiting]" used by the log. */
PCSim.Semaphore.prototype.describe = function () {
  var q = this.queue.map(function (t) { return t.name; }).join(', ');
  return this.name + ' = ' + this.value + (q ? '  [' + q + ' waiting]' : '');
};

/* ---------------------------------------------------------------------
 * SpinLock: a single boolean flag manipulated with an atomic
 * test_and_set(). Used only by Algorithm 2 (busy waiting).
 * ------------------------------------------------------------------- */
PCSim.SpinLock = function () {
  this.locked = false;
  this.owner = null;
  this.failedAttempts = 0;
};

/**
 * Atomically read the old value and set the flag to true.
 * @returns {boolean} the OLD value: false means the caller now owns the lock
 */
PCSim.SpinLock.prototype.testAndSet = function (thread) {
  var old = this.locked;
  this.locked = true;
  if (!old) this.owner = thread;
  else this.failedAttempts++;
  return old;
};

PCSim.SpinLock.prototype.release = function () {
  this.locked = false;
  this.owner = null;
};
