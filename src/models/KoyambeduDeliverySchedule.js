// ============================================================
// KOYAMBEDU DELIVERY SCHEDULE MODEL
// One document per delivery date.
// Each date has 4 configurable time slots.
// Super Admin can open/close dates and enable/disable slots.
// ============================================================
const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Default slot templates (applied when auto-generating schedules) ──
const DEFAULT_SLOTS = [
  { key: 'slot1', label: '7 AM – 9 AM',   display: 'Slot 1  ·  7 AM – 9 AM',   startHour: 7,  endHour: 9,  maxCapacity: 100 },
  { key: 'slot2', label: '9 AM – 12 PM',  display: 'Slot 2  ·  9 AM – 12 PM',  startHour: 9,  endHour: 12, maxCapacity: 100 },
  { key: 'slot3', label: '12 PM – 2 PM',  display: 'Slot 3  ·  12 PM – 2 PM',  startHour: 12, endHour: 14, maxCapacity: 100 },
  { key: 'slot4', label: '2 PM – 4 PM',   display: 'Slot 4  ·  2 PM – 4 PM',   startHour: 14, endHour: 16, maxCapacity: 100 },
];

const slotSchema = new Schema({
  key:          { type: String, enum: ['slot1','slot2','slot3','slot4'], required: true },
  label:        { type: String, required: true },   // "7 AM – 9 AM"
  display:      { type: String, required: true },   // "Slot 1 · 7 AM – 9 AM"
  startHour:    { type: Number, required: true },   // 7 (IST hour cutoff for today-availability)
  endHour:      { type: Number, required: true },   // 9
  maxCapacity:  { type: Number, default: 100 },
  currentOrders:{ type: Number, default: 0 },       // cached; refreshed on admin view
  isEnabled:    { type: Boolean, default: true },
  updatedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  updatedByName:{ type: String },
  updatedAt:    { type: Date },
}, { _id: false });

const auditLogSchema = new Schema({
  action:       { type: String },   // 'date_opened','date_closed','slot_enabled','slot_disabled','capacity_changed'
  slotKey:      { type: String },   // null for date-level actions
  field:        { type: String },
  prevValue:    { type: Schema.Types.Mixed },
  newValue:     { type: Schema.Types.Mixed },
  updatedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  updatedByName:{ type: String },
  timestamp:    { type: Date, default: Date.now },
}, { _id: false });

const deliveryScheduleSchema = new Schema({
  // Stored as start-of-day UTC midnight; queried by ISO date string
  date:       { type: Date, required: true, unique: true, index: true },
  // Human-readable ISO date for easy queries (e.g. "2026-07-08")
  dateISO:    { type: String, required: true, unique: true, index: true },
  status:     { type: String, enum: ['open','closed'], default: 'open' },
  slots:      { type: [slotSchema], default: () => DEFAULT_SLOTS.map(s => ({ ...s })) },
  auditLog:   { type: [auditLogSchema], default: [] },
  createdBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── Static: build fresh slot array from defaults ──────────────────
deliveryScheduleSchema.statics.defaultSlots = function() {
  return DEFAULT_SLOTS.map(s => ({ ...s }));
};

// ── Static: get or auto-create schedule for a given ISO date ─────
deliveryScheduleSchema.statics.getOrCreate = async function(dateISO) {
  let sched = await this.findOne({ dateISO });
  if (!sched) {
    const date = new Date(dateISO + 'T00:00:00.000Z');
    sched = await this.create({
      date,
      dateISO,
      slots: DEFAULT_SLOTS.map(s => ({ ...s })),
    });
  }
  return sched;
};

// ── Helper to push an audit log entry ─────────────────────────────
deliveryScheduleSchema.methods.addAudit = function(action, opts = {}) {
  this.auditLog.push({
    action,
    slotKey:       opts.slotKey   || null,
    field:         opts.field     || null,
    prevValue:     opts.prevValue ?? null,
    newValue:      opts.newValue  ?? null,
    updatedBy:     opts.updatedBy || null,
    updatedByName: opts.updatedByName || null,
    timestamp:     new Date(),
  });
};

module.exports = mongoose.model('KoyambeduDeliverySchedule', deliveryScheduleSchema);
module.exports.DEFAULT_SLOTS = DEFAULT_SLOTS;
