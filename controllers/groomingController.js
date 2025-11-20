import Booking from '../models/Booking.js';
import BookingAudit from '../models/BookingAudit.js';

// Static services list (could be moved to DB later)
const SERVICES = [
  { id: 'wash', name: 'Wash', durationMin: 30, price: 20 },
  { id: 'cut', name: 'Hair Cut', durationMin: 45, price: 35 },
  { id: 'nails', name: 'Nail Trim', durationMin: 15, price: 10 },
];

// Generate next 14 days availability (simple static slots)
function generateDates(days = 14) {
  const out = [];
  const start = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    out.push(d);
  }
  return out;
}

const BASE_SLOTS = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'];
// Capacity per slot (can override via env BOOKING_SLOT_CAPACITY)
const SLOT_CAPACITY = parseInt(process.env.BOOKING_SLOT_CAPACITY || '4', 10);

export async function getAvailability(req, res) {
  try {
    const dates = generateDates(14);
    // Fetch existing bookings to compute remaining capacity (exclude cancelled)
    const existing = await Booking.find({ date: { $in: dates }, status: { $ne: 'cancelled' } }).select('date time').lean();
    // Build count map
    const countMap = {};
    existing.forEach(b => {
      if (!countMap[b.date]) countMap[b.date] = {};
      countMap[b.date][b.time] = (countMap[b.date][b.time] || 0) + 1;
    });
    const slots = {};
    const slotRemaining = {};
    dates.forEach(d => {
      slots[d] = BASE_SLOTS; // keep legacy array of strings for compatibility
      slotRemaining[d] = {};
      BASE_SLOTS.forEach(t => {
        const used = countMap[d]?.[t] || 0;
        const remaining = Math.max(SLOT_CAPACITY - used, 0);
        slotRemaining[d][t] = remaining;
      });
    });
    res.json({ dates, slots, slotRemaining, capacity: SLOT_CAPACITY, services: SERVICES });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load availability', error: e?.message || e });
  }
}

export async function createBooking(req, res) {
  try {
    const { date, time, services, petId } = req.body || {};
    if (!date || !time || !Array.isArray(services) || !services.length) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    // Basic validation: ensure date is in availability range
    const dates = generateDates(30);
    if (!dates.includes(date)) {
      return res.status(400).json({ message: 'Date out of range' });
    }
    if (!BASE_SLOTS.includes(time)) {
      return res.status(400).json({ message: 'Invalid time slot' });
    }
    // Capacity check (exclude cancelled bookings)
    const existingCount = await Booking.countDocuments({ date, time, status: { $ne: 'cancelled' } });
    if (existingCount >= SLOT_CAPACITY) {
      return res.status(409).json({ message: 'Slot full', capacity: SLOT_CAPACITY, remaining: 0 });
    }
    // Map incoming service ids or objects
    let normalizedServices = [];
    services.forEach(s => {
      if (!s) return;
      if (typeof s === 'string') {
        const found = SERVICES.find(x => x.id === s);
        if (found) normalizedServices.push(found);
      } else if (s.id) {
        const found = SERVICES.find(x => x.id === s.id);
        if (found) normalizedServices.push(found);
      }
    });
    if (!normalizedServices.length) {
      return res.status(400).json({ message: 'No valid services' });
    }
    const booking = await Booking.create({
      date,
      time,
      services: normalizedServices,
      petId: petId || undefined,
      user: req.user?._id || undefined,
    });
    // Audit log
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: 'create',
        by: req.user?._id || undefined,
        statusAfter: booking.status,
        meta: { services: booking.services.map(s => s.id) }
      });
    } catch {}
    // Compute remaining after creation
    const remainingAfter = Math.max(SLOT_CAPACITY - (existingCount + 1), 0);
    res.status(201).json({ booking, capacity: SLOT_CAPACITY, remaining: remainingAfter });
  } catch (e) {
    console.error('[booking][error]', e);
    res.status(500).json({ message: 'Failed to create booking', error: e?.message || e });
  }
}

export async function listBookings(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const skip = (page - 1) * limit;
    // Filters
    const { status, date, from, to } = req.query;
    const q = {};
    if (status && typeof status === 'string') {
      q.status = status;
    }
    // date exact
    if (date && typeof date === 'string') {
      q.date = date;
    } else if (from || to) {
      // Build date range if at least one bound provided
      const range = {};
      if (from && typeof from === 'string') range.$gte = from;
      if (to && typeof to === 'string') range.$lte = to;
      if (Object.keys(range).length) q.date = range;
    }
    const total = await Booking.countDocuments(q);
    const bookings = await Booking.find(q)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', '_id email role');
    res.json({ page, total, pageSize: bookings.length, bookings, filters: { status: status || null, date: date || null, from: from || null, to: to || null } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load bookings', error: e?.message || e });
  }
}

export async function updateBookingStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ message: 'Missing id or status' });
    }
    const allowed = ['pending','confirmed','completed','cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    const before = booking.status;
    booking.status = status;
    await booking.save();
    // Audit log
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: status === 'cancelled' ? 'cancel' : 'status-change',
        by: req.user?._id || undefined,
        statusBefore: before,
        statusAfter: booking.status,
      });
    } catch {}
    res.json({ booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update booking', error: e?.message || e });
  }
}

export async function getBookingById(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const booking = await Booking.findById(id).populate('user', '_id email role');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    res.json({ booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load booking', error: e?.message || e });
  }
}

export async function cancelBooking(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    // Permission: admin or owner
    const isAdmin = req.user?.role === 'admin';
    const isOwner = req.user && booking.user && String(booking.user) === String(req.user._id);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Not authorized to cancel this booking' });
    }
    if (booking.status === 'cancelled') {
      return res.status(200).json({ booking, message: 'Already cancelled' });
    }
    const before = booking.status;
    booking.status = 'cancelled';
    await booking.save();
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: 'cancel',
        by: req.user?._id || undefined,
        statusBefore: before,
        statusAfter: booking.status,
      });
    } catch {}
    res.json({ booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to cancel booking', error: e?.message || e });
  }
}

export async function getBookingAudit(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const exists = await Booking.findById(id).select('_id');
    if (!exists) return res.status(404).json({ message: 'Booking not found' });
    const logs = await BookingAudit.find({ booking: id }).sort({ createdAt: -1 }).populate('by', '_id email role');
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load audit', error: e?.message || e });
  }
}

// Authenticated user: list own bookings with optional status/date filters
export async function getMyBookings(req, res) {
  try {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    const { status, date } = req.query;
    const q = { user: req.user._id };
    if (status && typeof status === 'string') q.status = status;
    if (date && typeof date === 'string') q.date = date;
    const bookings = await Booking.find(q).sort({ date: 1, time: 1 });
    res.json({ bookings, count: bookings.length });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load user bookings', error: e?.message || e });
  }
}

// User or admin: reschedule booking (change date/time) if capacity allows
export async function rescheduleBooking(req, res) {
  try {
    const { id } = req.params;
    const { date: newDate, time: newTime } = req.body || {};
    if (!id || !newDate || !newTime) return res.status(400).json({ message: 'Missing id, date or time' });
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    // Permission: admin or owner
    const isAdmin = req.user?.role === 'admin';
    const isOwner = req.user && booking.user && String(booking.user) === String(req.user._id);
    if (!isAdmin && !isOwner) return res.status(403).json({ message: 'Not authorized to reschedule this booking' });
    // Prevent reschedule if cancelled or completed
    if (['cancelled','completed'].includes(booking.status)) {
      return res.status(400).json({ message: 'Cannot reschedule a completed or cancelled booking' });
    }
    // Validate new date/time in availability range
    const dates = generateDates(30);
    if (!dates.includes(newDate)) return res.status(400).json({ message: 'Date out of range' });
    if (!BASE_SLOTS.includes(newTime)) return res.status(400).json({ message: 'Invalid time slot' });
    // Capacity check (exclude cancelled) for target slot excluding current booking if same slot
    const existingCount = await Booking.countDocuments({ date: newDate, time: newTime, status: { $ne: 'cancelled' }, _id: { $ne: booking._id } });
    if (existingCount >= SLOT_CAPACITY) {
      return res.status(409).json({ message: 'Target slot full', capacity: SLOT_CAPACITY, remaining: 0 });
    }
    const beforeDate = booking.date;
    const beforeTime = booking.time;
    booking.date = newDate;
    booking.time = newTime;
    await booking.save();
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: 'reschedule',
        by: req.user?._id || undefined,
        statusBefore: booking.status,
        statusAfter: booking.status,
        meta: { from: { date: beforeDate, time: beforeTime }, to: { date: newDate, time: newTime } }
      });
    } catch {}
    const remainingAfter = Math.max(SLOT_CAPACITY - (existingCount + 1), 0);
    res.json({ booking, capacity: SLOT_CAPACITY, remaining: remainingAfter });
  } catch (e) {
    res.status(500).json({ message: 'Failed to reschedule booking', error: e?.message || e });
  }
}
