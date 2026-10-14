// ============================================================
// KOYAMBEDU DELIVERY SCHEDULE CONTROLLER
// Super Admin: full CRUD on schedules + slots
// Customer:    read-only available slots for checkout
// ============================================================
const KoyambeduDeliverySchedule = require('../models/KoyambeduDeliverySchedule');
const KoyambeduOrder = require('../models/KoyambeduOrder');
const KoyambeduSettings = require('../models/KoyambeduSettings');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Whole days from today (IST) to dateISO. */
const daysFromToday = (dateISO) => Math.round((new Date(dateISO + 'T00:00:00Z') - new Date(istDateISO() + 'T00:00:00Z')) / DAY_MS);
/** Bookable = today..today+advanceDays-1, or a later date the admin opened for pre-booking. */
const isBookable = (dateISO, cfg, sched) => {
  const d = daysFromToday(dateISO);
  if (d < 0) return false;
  if (d < cfg.advanceDays) return true;
  return !!(sched && sched.advanceOpen && sched.status === 'open');
};

// ── Helpers ──────────────────────────────────────────────────
/** IST offset = UTC+5:30 */
const toIST = (d = new Date()) => new Date(d.getTime() + 5.5 * 60 * 60 * 1000);

/** YYYY-MM-DD string in IST */
const istDateISO = (d = new Date()) => toIST(d).toISOString().slice(0, 10);

/** Current IST hour (0-23) */
const istHour = () => toIST().getUTCHours();

/** Refresh currentOrders on every slot from live DB count */
async function syncOrderCounts(sched) {
  const dateISO = sched.dateISO;
  const counts = await KoyambeduOrder.aggregate([
    { $match: {
        deliveryDate: dateISO,
        orderStatus: { $nin: ['cancelled', 'failed'] },
    }},
    { $group: { _id: '$deliverySlotKey', count: { $sum: 1 } } },
  ]);
  const map = {};
  counts.forEach(c => { map[c._id] = c.count; });
  sched.slots.forEach(sl => { sl.currentOrders = map[sl.key] || 0; });
  return sched;
}

// ── 1. Public: available slots for checkout ──────────────────
// GET /api/koyambedu/schedule/available?date=2026-07-08
exports.getAvailableSlots = async (req, res) => {
  try {
    const dateISO = req.query.date || istDateISO();
    const today   = istDateISO();
    const isToday = dateISO === today;
    const hour    = istHour();

    const cfg   = await KoyambeduSettings.getScheduleConfig();
    const sched = await KoyambeduDeliverySchedule.getOrCreate(dateISO);

    if (!isBookable(dateISO, cfg, sched)) {
      return res.json({ success: true, available: [], scheduleStatus: 'closed', notBookable: true });
    }

    // Sync live order counts
    await syncOrderCounts(sched);
    // No need to save — counts are read-only here

    if (sched.status !== 'open') {
      return res.json({ success: true, available: [], scheduleStatus: 'closed' });
    }

    const available = sched.slots
      .filter(sl => {
        if (!KoyambeduDeliverySchedule.slotEffective(sl, cfg.disabledSlots)) return false;
        if (sl.currentOrders >= sl.maxCapacity) return false;
        // For today: slot must not have already started
        if (isToday && hour >= sl.startHour) return false;
        return true;
      })
      .map(sl => ({
        key:        sl.key,
        label:      sl.label,
        display:    sl.display,
        remaining:  sl.maxCapacity - sl.currentOrders,
      }));

    res.json({ success: true, available, scheduleStatus: 'open' });
  } catch (err) {
    console.error('[Schedule] getAvailableSlots error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 2. Admin: list schedules ─────────────────────────────────
// GET /api/koyambedu/admin/schedule?from=2026-07-01&to=2026-07-31&status=open
exports.adminGetSchedules = async (req, res) => {
  try {
    const { from, to, status, slotStatus } = req.query;
    const filter = {};
    if (from || to) {
      filter.dateISO = {};
      if (from) filter.dateISO.$gte = from;
      if (to)   filter.dateISO.$lte = to;
    }
    if (status) filter.status = status;

    let scheds = await KoyambeduDeliverySchedule.find(filter).sort({ dateISO: 1 }).lean();

    // Sync counts for each
    const dateISOs = scheds.map(s => s.dateISO);
    const countAgg = await KoyambeduOrder.aggregate([
      { $match: {
          deliveryDate: { $in: dateISOs },
          orderStatus: { $nin: ['cancelled', 'failed'] },
      }},
      { $group: { _id: { date: '$deliveryDate', slot: '$deliverySlotKey' }, count: { $sum: 1 } } },
    ]);
    const countMap = {};
    countAgg.forEach(c => {
      const k = `${c._id.date}::${c._id.slot}`;
      countMap[k] = c.count;
    });

    const cfg = await KoyambeduSettings.getScheduleConfig();
    scheds = scheds.map(s => ({
      ...s,
      inWindow: daysFromToday(s.dateISO) >= 0 && daysFromToday(s.dateISO) < cfg.advanceDays,
      slots: s.slots.map(sl => {
        const eff = KoyambeduDeliverySchedule.slotEffective(sl, cfg.disabledSlots);
        return {
          ...sl,
          globalOff:     cfg.disabledSlots.includes(sl.key),
          isEnabled:     eff,            // effective state the UI shows
          currentOrders: countMap[`${s.dateISO}::${sl.key}`] || 0,
          remaining:     sl.maxCapacity - (countMap[`${s.dateISO}::${sl.key}`] || 0),
        };
      }),
    }));

    // Filter by slotStatus if provided
    if (slotStatus) {
      const wantEnabled = slotStatus === 'enabled';
      scheds = scheds.filter(s => s.slots.some(sl => sl.isEnabled === wantEnabled));
    }

    // Summary stats
    const today = istDateISO();
    const tomorrow = new Date(new Date().getTime() + 24*60*60*1000).toISOString().slice(0,10);
    const todayOrders = countAgg
      .filter(c => c._id.date === today)
      .reduce((sum, c) => sum + c.count, 0);
    const tomorrowOrders = countAgg
      .filter(c => c._id.date === tomorrow)
      .reduce((sum, c) => sum + c.count, 0);
    const totalOrders = countAgg.reduce((sum, c) => sum + c.count, 0);

    const stats = {
      totalDates:     scheds.length,
      activeDates:    scheds.filter(s => s.status === 'open').length,
      closedDates:    scheds.filter(s => s.status === 'closed').length,
      totalSlots:     scheds.reduce((n, s) => n + s.slots.length, 0),
      enabledSlots:   scheds.reduce((n, s) => n + s.slots.filter(sl => sl.isEnabled).length, 0),
      disabledSlots:  scheds.reduce((n, s) => n + s.slots.filter(sl => !sl.isEnabled).length, 0),
      totalOrders,
      todayOrders,
      tomorrowOrders,
    };

    res.json({ success: true, schedules: scheds, stats });
  } catch (err) {
    console.error('[Schedule] adminGetSchedules error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 3. Admin: generate schedules for next N days ─────────────
// POST /api/koyambedu/admin/schedule/generate  { days: 14 }
exports.generateSchedules = async (req, res) => {
  try {
    const days  = Math.min(parseInt(req.body.days) || 14, 90);
    const today = istDateISO();
    const created = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(today + 'T00:00:00.000Z');
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const exists = await KoyambeduDeliverySchedule.findOne({ dateISO: iso });
      if (!exists) {
        const sched = await KoyambeduDeliverySchedule.create({
          date:     d,
          dateISO:  iso,
          createdBy: req.user._id,
          updatedBy: req.user._id,
        });
        created.push(iso);
      }
    }

    res.json({ success: true, created, message: `Generated ${created.length} new schedule(s)` });
  } catch (err) {
    console.error('[Schedule] generateSchedules error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 4. Admin: toggle entire date open/closed ─────────────────
// PATCH /api/koyambedu/admin/schedule/:id/status  { status: 'closed' }
exports.toggleDateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open','closed'].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'open' or 'closed'" });
    }
    const sched = await KoyambeduDeliverySchedule.findById(req.params.id);
    if (!sched) return res.status(404).json({ success: false, message: 'Schedule not found' });

    const prev = sched.status;
    sched.status    = status;
    sched.updatedBy = req.user._id;
    sched.addAudit(status === 'open' ? 'date_opened' : 'date_closed', {
      field:         'status',
      prevValue:     prev,
      newValue:      status,
      updatedBy:     req.user._id,
      updatedByName: req.user.name || req.user.email,
    });
    await sched.save();

    res.json({ success: true, schedule: sched, message: `Delivery date ${sched.dateISO} is now ${status}` });
  } catch (err) {
    console.error('[Schedule] toggleDateStatus error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 5. Admin: toggle individual slot enabled/disabled ─────────
// PATCH /api/koyambedu/admin/schedule/:id/slots/:slotKey/status  { isEnabled: false }
exports.toggleSlotStatus = async (req, res) => {
  try {
    const { slotKey } = req.params;
    const { isEnabled, reset } = req.body;
    if (!reset && typeof isEnabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isEnabled must be boolean (or reset: true)' });
    }
    const sched = await KoyambeduDeliverySchedule.findById(req.params.id);
    if (!sched) return res.status(404).json({ success: false, message: 'Schedule not found' });

    const slot = sched.slots.find(s => s.key === slotKey);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });

    const prev = slot.override || (slot.isEnabled === false ? 'off' : 'global');
    if (reset) {                      // follow the global switch again
      slot.override  = null;
      slot.isEnabled = true;
    } else {                          // explicit day-level decision (beats the global switch)
      slot.override  = isEnabled ? 'on' : 'off';
      slot.isEnabled = isEnabled;
    }
    slot.updatedBy    = req.user._id;
    slot.updatedByName= req.user.name || req.user.email;
    slot.updatedAt    = new Date();
    sched.updatedBy   = req.user._id;

    sched.addAudit(reset ? 'slot_reset_to_global' : (isEnabled ? 'slot_enabled' : 'slot_disabled'), {
      slotKey,
      field:         'override',
      prevValue:     prev,
      newValue:      reset ? 'global' : (isEnabled ? 'on' : 'off'),
      updatedBy:     req.user._id,
      updatedByName: req.user.name || req.user.email,
    });
    await sched.save();

    res.json({ success: true, slot, message: reset ? `${slotKey} now follows the global setting` : `${slotKey} is now ${isEnabled ? 'enabled' : 'disabled'} for this day` });
  } catch (err) {
    console.error('[Schedule] toggleSlotStatus error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 6. Admin: update slot capacity ───────────────────────────
// PATCH /api/koyambedu/admin/schedule/:id/slots/:slotKey/capacity  { maxCapacity: 150 }
exports.updateSlotCapacity = async (req, res) => {
  try {
    const { slotKey } = req.params;
    const maxCapacity = parseInt(req.body.maxCapacity);
    if (isNaN(maxCapacity) || maxCapacity < 1) {
      return res.status(400).json({ success: false, message: 'maxCapacity must be a positive integer' });
    }
    const sched = await KoyambeduDeliverySchedule.findById(req.params.id);
    if (!sched) return res.status(404).json({ success: false, message: 'Schedule not found' });

    const slot = sched.slots.find(s => s.key === slotKey);
    if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });

    const prev = slot.maxCapacity;
    slot.maxCapacity  = maxCapacity;
    slot.updatedBy    = req.user._id;
    slot.updatedByName= req.user.name || req.user.email;
    slot.updatedAt    = new Date();
    sched.updatedBy   = req.user._id;

    sched.addAudit('capacity_changed', {
      slotKey,
      field:         'maxCapacity',
      prevValue:     prev,
      newValue:      maxCapacity,
      updatedBy:     req.user._id,
      updatedByName: req.user.name || req.user.email,
    });
    await sched.save();

    res.json({ success: true, slot, message: `Capacity updated to ${maxCapacity}` });
  } catch (err) {
    console.error('[Schedule] updateSlotCapacity error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 7. Admin: schedule stats dashboard ───────────────────────
// GET /api/koyambedu/admin/schedule/stats
exports.getScheduleStats = async (req, res) => {
  try {
    const today    = istDateISO();
    const tomorrow = new Date(new Date().getTime() + 24*60*60*1000).toISOString().slice(0,10);

    const [total, openCount, todaySched, tomorrowSched, todayOrders, tomorrowOrders] = await Promise.all([
      KoyambeduDeliverySchedule.countDocuments(),
      KoyambeduDeliverySchedule.countDocuments({ status: 'open' }),
      KoyambeduDeliverySchedule.findOne({ dateISO: today }),
      KoyambeduDeliverySchedule.findOne({ dateISO: tomorrow }),
      KoyambeduOrder.countDocuments({ deliveryDate: today, orderStatus: { $nin: ['cancelled','failed'] } }),
      KoyambeduOrder.countDocuments({ deliveryDate: tomorrow, orderStatus: { $nin: ['cancelled','failed'] } }),
    ]);

    res.json({
      success: true,
      stats: {
        totalDates:      total,
        activeDates:     openCount,
        closedDates:     total - openCount,
        todayStatus:     todaySched?.status || 'not-configured',
        tomorrowStatus:  tomorrowSched?.status || 'not-configured',
        todayOrders,
        tomorrowOrders,
      },
    });
  } catch (err) {
    console.error('[Schedule] getScheduleStats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 8. Validate slot at order placement (used in placeOrder) ─
// Returns { valid: bool, message: string }
exports.validateSlotForOrder = async (dateISO, slotKey) => {
  const today  = istDateISO();
  const isToday = dateISO === today;
  const hour   = istHour();

  const cfg   = await KoyambeduSettings.getScheduleConfig();
  const sched = await KoyambeduDeliverySchedule.getOrCreate(dateISO);
  if (!isBookable(dateISO, cfg, sched)) {
    return { valid: false, message: 'Bookings are not open for the selected date yet. Please choose an available date.' };
  }
  if (sched.status !== 'open') {
    return { valid: false, message: 'Delivery is not available for the selected date.' };
  }

  const slot = sched.slots.find(s => s.key === slotKey);
  if (!slot) {
    return { valid: false, message: 'Invalid delivery slot.' };
  }
  if (!KoyambeduDeliverySchedule.slotEffective(slot, cfg.disabledSlots)) {
    return { valid: false, message: `The selected delivery slot (${slot.label}) is no longer available. Please choose another slot.` };
  }

  // Count live orders for this slot
  const currentOrders = await KoyambeduOrder.countDocuments({
    deliveryDate:  dateISO,
    deliverySlotKey: slotKey,
    orderStatus:   { $nin: ['cancelled','failed'] },
  });
  if (currentOrders >= slot.maxCapacity) {
    return { valid: false, message: `The selected slot (${slot.label}) is fully booked. Please choose another slot.` };
  }

  // For today: slot must not have started yet
  if (isToday && hour >= slot.startHour) {
    return { valid: false, message: `The selected slot (${slot.label}) has already started. Please choose another slot.` };
  }

  return { valid: true };
};


// ── 9. Public: bookable dates beyond tomorrow ────────────────
// GET /api/koyambedu/schedule/config → { advanceDays, laterDates: [{ dateISO }] }
// Dates from day-after-tomorrow up to the booking window, plus any date the
// admin opened for pre-booking. Today/tomorrow stay as the existing tabs.
exports.getPublicConfig = async (req, res) => {
  try {
    const cfg = await KoyambeduSettings.getScheduleConfig();
    const today = istDateISO();
    const set = new Map();
    for (let i = 2; i < cfg.advanceDays; i++) {
      const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
      set.set(d.toISOString().slice(0, 10), true);
    }
    const extra = await KoyambeduDeliverySchedule.find({ advanceOpen: true, status: 'open', dateISO: { $gt: today } }).select('dateISO slots').lean();
    for (const e of extra) if (daysFromToday(e.dateISO) >= 2) set.set(e.dateISO, true);
    // Drop dates the admin closed or that have every slot off
    const dates = [...set.keys()].sort();
    const docs = await KoyambeduDeliverySchedule.find({ dateISO: { $in: dates } }).lean();
    const byISO = new Map(docs.map(d => [d.dateISO, d]));
    const laterDates = dates.filter(iso => {
      const d = byISO.get(iso);
      if (!d) return cfg.disabledSlots.length < 4;                    // not created yet → follows global switches
      if (d.status === 'closed') return false;
      return d.slots.some(sl => KoyambeduDeliverySchedule.slotEffective(sl, cfg.disabledSlots));
    }).map(dateISO => ({ dateISO }));
    res.json({ success: true, advanceDays: cfg.advanceDays, laterDates });
  } catch (err) {
    console.error('[Schedule] getPublicConfig error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 10. Admin: booking window + global slot switches ─────────
// GET/PUT /api/koyambedu/admin/schedule/config
exports.adminGetConfig = async (req, res) => {
  try {
    const cfg = await KoyambeduSettings.getScheduleConfig();
    const { DEFAULT_SLOTS } = require('../models/KoyambeduDeliverySchedule');
    res.json({ success: true, ...cfg, slots: DEFAULT_SLOTS.map(s => ({ key: s.key, label: s.label })) });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
};

exports.adminSaveConfig = async (req, res) => {
  try {
    const advanceDays = Math.floor(Number(req.body.advanceDays));
    if (!Number.isFinite(advanceDays) || advanceDays < 1 || advanceDays > 90) {
      return res.status(400).json({ success: false, message: 'Booking days must be between 1 and 90' });
    }
    const valid = ['slot1', 'slot2', 'slot3', 'slot4'];
    const disabledSlots = (Array.isArray(req.body.disabledSlots) ? req.body.disabledSlots : []).filter(k => valid.includes(k));
    await KoyambeduSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { 'scheduleConfig.advanceDays': advanceDays, 'scheduleConfig.disabledSlots': disabledSlots,
                'scheduleConfig.updatedByName': req.user.name || req.user.email, 'scheduleConfig.updatedAt': new Date() } },
      { upsert: true, setDefaultsOnInsert: true });
    res.json({ success: true, advanceDays, disabledSlots, message: 'Booking settings saved' });
  } catch (err) {
    console.error('[Schedule] adminSaveConfig error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── 11. Admin: open / close ONE date for pre-booking (beyond the window) ──
// POST /api/koyambedu/admin/schedule/advance-open { dateISO, advanceOpen }
exports.setAdvanceOpen = async (req, res) => {
  try {
    const { dateISO } = req.body;
    const open = req.body.advanceOpen !== false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || ''))) return res.status(400).json({ success: false, message: 'Valid date required' });
    if (daysFromToday(dateISO) < 0) return res.status(400).json({ success: false, message: 'Date is in the past' });
    if (daysFromToday(dateISO) > 365) return res.status(400).json({ success: false, message: 'Date too far ahead' });
    const sched = await KoyambeduDeliverySchedule.getOrCreate(dateISO);
    sched.advanceOpen = open;
    if (open) sched.status = 'open';
    sched.updatedBy = req.user._id;
    sched.addAudit(open ? 'prebooking_opened' : 'prebooking_closed', {
      field: 'advanceOpen', prevValue: !open, newValue: open, updatedBy: req.user._id, updatedByName: req.user.name || req.user.email,
    });
    await sched.save();
    res.json({ success: true, schedule: sched, message: open ? `${dateISO} is open for pre-booking` : `${dateISO} pre-booking closed` });
  } catch (err) {
    console.error('[Schedule] setAdvanceOpen error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
