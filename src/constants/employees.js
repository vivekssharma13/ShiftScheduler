export const ROLE = {
  LEAD: "Lead",
  SENIOR: "Senior",
  JUNIOR: "Junior",
};

export const WEEKLY_OFF = {
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

export const EMPLOYEES = [
  { id: "AZM", name: "AZM", role: ROLE.LEAD, weeklyOff: WEEKLY_OFF.SUNDAY },

  { id: "VLD", name: "VLD", role: ROLE.SENIOR, weeklyOff: WEEKLY_OFF.SATURDAY },
  { id: "TEJ", name: "TEJ", role: ROLE.SENIOR, weeklyOff: WEEKLY_OFF.SUNDAY },

  { id: "EKR", name: "EKR", role: ROLE.JUNIOR, weeklyOff: WEEKLY_OFF.SATURDAY },
  { id: "ISK", name: "ISK", role: ROLE.JUNIOR, weeklyOff: WEEKLY_OFF.SATURDAY },
  { id: "SAI", name: "SAI", role: ROLE.JUNIOR, weeklyOff: WEEKLY_OFF.SUNDAY },
  { id: "PRD", name: "PRD", role: ROLE.JUNIOR, weeklyOff: WEEKLY_OFF.SUNDAY },
  { id: "DSV", name: "DSV", role: ROLE.JUNIOR, weeklyOff: WEEKLY_OFF.SATURDAY },
];

export const WEEKLY_OFF_BY_DAY = {
  [WEEKLY_OFF.SATURDAY]: ["VLD", "EKR", "ISK", "DSV"],
  [WEEKLY_OFF.SUNDAY]: ["AZM", "TEJ", "SAI", "PRD"],
};

export function isLeadOrSenior(employee) {
  return employee.role === ROLE.LEAD || employee.role === ROLE.SENIOR;
}
