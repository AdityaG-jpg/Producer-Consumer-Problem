/* =====================================================================
 * thread.js
 * ---------------------------------------------------------------------
 * Layer : Producer Thread Module | Consumer Thread Module
 *
 * A simulated thread = a program (list of instructions) + a program
 * counter (pc) + bookkeeping used for the performance parameters.
 *
 * Thread states shown in the GUI (Stage 1 report, Section 6.2):
 *   ready    - idle, waiting for the scheduler to give it a CPU
 *   running  - executed an instruction in the current tick
 *   blocked  - asleep on a semaphore (uses NO CPU)
 *   spinning - busy-waiting (uses CPU but makes no progress)
 *   waking   - just signalled, paying the context-switch cost
 *   done     - finished all its items
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

/**
 * @param {string} role     'producer' | 'consumer'
 * @param {number} index    1-based number within its role (P1, P2, C1 ...)
 * @param {Array}  program  instruction list from PCSim.buildProgram()
 */
PCSim.SimThread = function (role, index, program) {
  this.role = role;
  this.index = index;
  this.name = (role === 'producer' ? 'P' : 'C') + index;
  this.program = program;
  this.pc = 0;
  this.state = 'ready';
  this.inIteration = false;   // consumer has claimed one item to consume
  this.workLeft = null;       // remaining ticks of the current compute instruction
  this.switchLeft = 0;        // remaining context-switch ticks after a wake-up
  this.item = null;           // item currently held by the thread
  this.reg = 0;               // private CPU register (no-sync demo: count = reg)
  this.blockedOn = null;      // semaphore the thread sleeps on
  this.spinReason = '';

  // statistics
  this.itemsDone = 0;         // items inserted (producer) or removed (consumer)
  this.seq = 0;               // next sequence number for produced items
  this.waitStart = null;      // tick when the current access attempt began
  this.waits = [];            // completed waiting times, in ticks
  this.cpuUseful = 0;
  this.cpuSpin = 0;
  this.cpuSwitch = 0;
  this.blockedTicks = 0;
  this.finishTick = null;
};

PCSim.SimThread.prototype.currentInstruction = function () {
  return this.program[this.pc] || null;
};

/* Can the scheduler give this thread a CPU in this tick? */
PCSim.SimThread.prototype.isRunnable = function () {
  return this.state !== 'blocked' && this.state !== 'done';
};

PCSim.SimThread.prototype.totalWait = function () {
  return this.waits.reduce(function (a, b) { return a + b; }, 0);
};

PCSim.SimThread.prototype.meanWait = function () {
  return this.waits.length ? this.totalWait() / this.waits.length : 0;
};

PCSim.SimThread.prototype.maxWait = function () {
  return this.waits.length ? Math.max.apply(null, this.waits) : 0;
};
