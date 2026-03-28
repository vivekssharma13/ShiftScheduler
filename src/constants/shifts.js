export const SHIFT = {
  A: "A",
  B: "B",
  C: "C",
};

export const SHIFT_LABEL = {
  [SHIFT.A]: "A Shift (7:00–15:00 IST)",
  [SHIFT.B]: "B Shift (15:00–23:00 IST)",
  [SHIFT.C]: "C Shift (23:00–7:00 IST)",
};

export const SHIFT_ORDER = [SHIFT.A, SHIFT.B, SHIFT.C];

export const MIN_STAFFING = {
  [SHIFT.A]: 1,
  [SHIFT.B]: 1,
  // C shift can go down to 1 only in emergency, but must never be 0.
  [SHIFT.C]: 1,
};

// What the scheduler will try to achieve when possible.
export const TARGET_STAFFING = {
  [SHIFT.A]: 1,
  [SHIFT.B]: 1,
  [SHIFT.C]: 2,
};

// Hard caps.
export const MAX_STAFFING = {
  [SHIFT.C]: 2,
};
