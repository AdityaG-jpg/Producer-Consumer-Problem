/* =====================================================================
 * buffer.js
 * ---------------------------------------------------------------------
 * Layer : Buffer Simulation Engine (Bounded Buffer Model)
 *
 * A circular buffer of N slots with an `in` index (next free slot for a
 * producer) and an `out` index (next full slot for a consumer).
 *
 * The buffer itself performs NO locking - protecting it is the job of
 * the algorithm being simulated. Instead it records every anomaly so
 * that the integrity check can prove whether an algorithm was correct:
 *   - overwritten : a producer wrote into a slot that still held an
 *                   unconsumed item  -> that item is LOST
 *   - duplicate   : a consumer read a slot that was already consumed
 *   - garbage     : a consumer read a slot that was never written
 * ===================================================================== */

var PCSim = (typeof PCSim !== 'undefined') ? PCSim : {};

PCSim.BoundedBuffer = function (size) {
  this.size = size;
  this.slots = [];
  for (var i = 0; i < size; i++) this.slots.push(null);  // slot = { item, valid } or null
  this.in = 0;
  this.out = 0;
  this.count = 0;              // the shared `count` variable used by Algorithm 2 / no-sync demo
  this.lastTouched = -1;       // slot index changed in the latest step (for the GUI highlight)
  this.stats = { inserted: 0, removed: 0, overwritten: 0, duplicate: 0, garbage: 0 };
  this.lostItems = [];         // items destroyed by an overwrite
  this.insertOrder = [];       // ids in the order they entered the buffer
  this.removeOrder = [];       // ids in the order they left the buffer
};

/* Number of slots that really hold an unconsumed item. */
PCSim.BoundedBuffer.prototype.occupancy = function () {
  var n = 0;
  for (var i = 0; i < this.size; i++) if (this.slots[i] && this.slots[i].valid) n++;
  return n;
};

PCSim.BoundedBuffer.prototype.isFull = function () { return this.occupancy() === this.size; };
PCSim.BoundedBuffer.prototype.isEmpty = function () { return this.occupancy() === 0; };

/**
 * Write an item into a given slot (no index update).
 * @returns {object|null} the item that was overwritten (lost), if any
 */
PCSim.BoundedBuffer.prototype.writeSlot = function (index, item) {
  var old = this.slots[index];
  var lost = null;
  if (old && old.valid) {                // unconsumed item destroyed -> data loss
    lost = old.item;
    this.stats.overwritten++;
    this.lostItems.push(lost);
  }
  this.slots[index] = { item: item, valid: true };
  this.stats.inserted++;
  this.insertOrder.push(item.id);
  this.lastTouched = index;
  return lost;
};

/**
 * Read (consume) the item in a given slot (no index update).
 * @returns {{item: object|null, status: string}} status = 'ok' | 'duplicate' | 'garbage'
 */
PCSim.BoundedBuffer.prototype.readSlot = function (index) {
  var s = this.slots[index];
  this.lastTouched = index;
  if (!s) {                               // never written
    this.stats.garbage++;
    return { item: null, status: 'garbage' };
  }
  if (!s.valid) {                         // already consumed earlier
    this.stats.duplicate++;
    return { item: s.item, status: 'duplicate' };
  }
  s.valid = false;
  this.stats.removed++;
  this.removeOrder.push(s.item.id);
  return { item: s.item, status: 'ok' };
};

/* Atomic insert used inside a protected critical section. */
PCSim.BoundedBuffer.prototype.insert = function (item) {
  var idx = this.in;
  var lost = this.writeSlot(idx, item);
  this.in = (this.in + 1) % this.size;
  return { index: idx, lost: lost };
};

/* Atomic remove used inside a protected critical section. */
PCSim.BoundedBuffer.prototype.remove = function () {
  var idx = this.out;
  var r = this.readSlot(idx);
  this.out = (this.out + 1) % this.size;
  r.index = idx;
  return r;
};
