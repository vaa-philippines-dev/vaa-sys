// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTING — CALCULATION ENGINE (§7 of the planning doc)
// ═══════════════════════════════════════════════════════════════════════
// Every billing formula lives here once. Invoice generation (§4.2-4.3),
// reconciliation, and reporting should all call these functions rather
// than recomputing the same math independently — that's the whole point
// of this file per the plan.
//
// Honest limitation: ActualHours (used for Postpaid billing and for
// Night Differential's QualifyingHours) has no attendance-import source
// yet — that's Phase 5 of the plan (Attendance Records/Import), not yet
// built. Until then, ActualHours is a manual input the person generating
// the invoice provides per VA, not something this engine can derive on
// its own. Every function that needs it takes it as a parameter rather
// than pretending to compute it from nothing.

// Finds the compensation-history entry effective as of a given date —
// not just whatever the connection's current live Rate is. This is what
// makes §4.7 possible: regenerating or auditing a past invoice uses the
// rate that was actually in effect then, even if it's since changed.
function getEffectiveRateAsOf(connectionId, asOfDate) {
  try {
    var histRes = getCompHistoryForConnection(connectionId);
    if (!histRes.success) return { success: false, error: histRes.error };
    var asOf = new Date(asOfDate);
    var match = histRes.data.find(function(h) {
      var eff = new Date(h.effectiveDate);
      var end = h.endDate ? new Date(h.endDate) : null;
      return eff <= asOf && (!end || asOf <= end);
    });
    if (!match) {
      // No history row covers this date — fall back to the connection's
      // own current Rate rather than failing outright, since a
      // connection created before compensation history existed as a
      // concept would otherwise have no effective rate at all.
      var connRes = getVAConnectionById(connectionId);
      if (!connRes.success) return { success: false, error: 'No compensation history and connection not found.' };
      return { success: true, rate: connRes.data.rate || 0, nightDiffActive: !!connRes.data.nightDiffApplicable, nightDiffType: 'Percentage', nightDiffValue: connRes.data.nightDiffPercent || 0, monthlySalaryIncrease: 0, source: 'connection-fallback' };
    }
    return { success: true, rate: match.rate, nightDiffActive: match.nightDiffActive, nightDiffType: match.nightDiffType, nightDiffValue: match.nightDiffValue, monthlySalaryIncrease: match.monthlySalaryIncrease, source: 'history' };
  } catch (e) {
    return { success: false, error: 'getEffectiveRateAsOf: ' + e.message };
  }
}

// Projected hours for a calendar month, from the connection's own weekly
// schedule total — (weekly hours ÷ 7) × actual days in that month, so
// February and a 31-day month aren't treated as equal.
function getProjectedHoursForMonth(connectionId, yearMonth) {
  try {
    var connRes = getVAConnectionById(connectionId);
    if (!connRes.success) return { success: false, error: connRes.error };
    var weeklyHours = Number(connRes.data.hours) || 0;
    var parts = String(yearMonth).split('-');
    var daysInMonth = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    var projected = (weeklyHours / 7) * daysInMonth;
    return { success: true, projectedHours: Math.round(projected * 100) / 100, daysInMonth: daysInMonth, weeklyHours: weeklyHours };
  } catch (e) {
    return { success: false, error: 'getProjectedHoursForMonth: ' + e.message };
  }
}

// §7: ServicePayment(VA, month) — branches on the customer's BillingType.
// actualHours is required for Postpaid (see the file-level note above —
// there's no attendance source to derive it from yet).
function calcServicePayment(connectionId, billingMonth, billingType, actualHours) {
  try {
    var rateRes = getEffectiveRateAsOf(connectionId, _acctMonthToDate(billingMonth));
    if (!rateRes.success) return { success: false, error: rateRes.error };
    var rate = rateRes.rate;

    if (billingType === 'Postpaid') {
      if (actualHours === undefined || actualHours === null || isNaN(Number(actualHours))) {
        return { success: false, error: 'Postpaid billing requires actualHours — no attendance-import source exists yet to derive this automatically.' };
      }
      return { success: true, amount: Math.round(Number(actualHours) * rate * 100) / 100, hoursUsed: Number(actualHours), rate: rate, basis: 'actual' };
    }

    // Prepaid: bill the upcoming month's projected hours.
    var projRes = getProjectedHoursForMonth(connectionId, billingMonth);
    if (!projRes.success) return { success: false, error: projRes.error };
    return { success: true, amount: Math.round(projRes.projectedHours * rate * 100) / 100, hoursUsed: projRes.projectedHours, rate: rate, basis: 'projected' };
  } catch (e) {
    return { success: false, error: 'calcServicePayment: ' + e.message };
  }
}

// §7: NightDifferential(VA, month) — qualifyingHours is a manual input
// for the same reason actualHours is (no attendance source yet).
function calcNightDifferential(connectionId, billingMonth, qualifyingHours) {
  try {
    if (!qualifyingHours) return { success: true, amount: 0, applicable: false };
    var rateRes = getEffectiveRateAsOf(connectionId, _acctMonthToDate(billingMonth));
    if (!rateRes.success) return { success: false, error: rateRes.error };
    if (!rateRes.nightDiffActive) return { success: true, amount: 0, applicable: false };

    var hours = Number(qualifyingHours);
    var amount;
    if (rateRes.nightDiffType === 'Fixed') {
      amount = hours * Number(rateRes.nightDiffValue);
    } else {
      // Percentage — a % of the base rate, applied per qualifying hour.
      amount = hours * rateRes.rate * (Number(rateRes.nightDiffValue) / 100);
    }
    return { success: true, amount: Math.round(amount * 100) / 100, applicable: true, type: rateRes.nightDiffType, value: rateRes.nightDiffValue, qualifyingHours: hours };
  } catch (e) {
    return { success: false, error: 'calcNightDifferential: ' + e.message };
  }
}

// §7: HoursAdjustment(VA, month) — the signed difference between actual
// and projected hours, valued at the effective rate. Per §3's integrity
// rule, this always applies to the NEXT billing cycle, never edits an
// issued invoice retroactively — enforced by the caller (this function
// only computes the value, it doesn't write anywhere).
function calcHoursAdjustment(connectionId, billingMonth, actualHours) {
  try {
    var projRes = getProjectedHoursForMonth(connectionId, billingMonth);
    if (!projRes.success) return { success: false, error: projRes.error };
    var rateRes = getEffectiveRateAsOf(connectionId, _acctMonthToDate(billingMonth));
    if (!rateRes.success) return { success: false, error: rateRes.error };

    var diffHours = Number(actualHours) - projRes.projectedHours;
    var diffValue = Math.round(diffHours * rateRes.rate * 100) / 100;
    return { success: true, differenceHours: Math.round(diffHours * 100) / 100, differenceValue: diffValue, projectedHours: projRes.projectedHours, actualHours: Number(actualHours), rate: rateRes.rate };
  } catch (e) {
    return { success: false, error: 'calcHoursAdjustment: ' + e.message };
  }
}

// §7: TrainingBondAccrual(VA, month) — accrues at $0.50/hr by default
// (or the bond's own configured Amount) until the bond's own
// ExpectedEndDate (start + 6 months, from VACompensationService.gs).
function calcTrainingBondAccrual(connectionId, hoursWorked) {
  try {
    var bondRes = getBondForConnection(connectionId);
    if (!bondRes.success) return { success: false, error: bondRes.error };
    if (!bondRes.data || bondRes.data.status === 'No Bond' || bondRes.data.status === 'Released' || bondRes.data.status === 'Forfeited') {
      return { success: true, amount: 0, applicable: false, reason: bondRes.data ? bondRes.data.status : 'No bond record' };
    }
    var deductionRate = Number(bondRes.data.amount) || 0.50;
    var amount = Math.round(Number(hoursWorked) * deductionRate * 100) / 100;
    return { success: true, amount: amount, applicable: true, deductionRate: deductionRate, expectedEndDate: bondRes.data.expectedEndDate };
  } catch (e) {
    return { success: false, error: 'calcTrainingBondAccrual: ' + e.message };
  }
}

// §4.3: Mid-Month VA Start Billing — prorates the first invoice based on
// how many days of the month remain from the target/actual start date.
// If the start date falls within the last few days of the month, the
// plan's own examples (Mar 15, Jan 27) suggest rolling the remainder
// into the following month rather than issuing a near-zero partial
// invoice — rollThresholdDays controls that cutoff (defaults to 5).
function calcProratedFirstMonth(connectionId, startDate, billingType, rollThresholdDays) {
  try {
    rollThresholdDays = rollThresholdDays || 5;
    var start = new Date(startDate);
    var daysInMonth = new Date(start.getFullYear(), start.getMonth()+1, 0).getDate();
    var remainingDays = daysInMonth - start.getDate() + 1;

    if (remainingDays <= rollThresholdDays) {
      return { success: true, prorate: false, rollToNextMonth: true, remainingDays: remainingDays,
        note: 'Only ' + remainingDays + ' day(s) left in the start month — rolled into next month\'s projected billing instead of a near-zero partial invoice.' };
    }

    var rateRes = getEffectiveRateAsOf(connectionId, start);
    if (!rateRes.success) return { success: false, error: rateRes.error };
    var connRes = getVAConnectionById(connectionId);
    if (!connRes.success) return { success: false, error: connRes.error };
    var weeklyHours = Number(connRes.data.hours) || 0;
    var dailyHours = weeklyHours / 7;
    var proratedHours = Math.round(dailyHours * remainingDays * 100) / 100;
    var amount = Math.round(proratedHours * rateRes.rate * 100) / 100;

    return { success: true, prorate: true, rollToNextMonth: false, remainingDays: remainingDays, proratedHours: proratedHours, amount: amount, rate: rateRes.rate };
  } catch (e) {
    return { success: false, error: 'calcProratedFirstMonth: ' + e.message };
  }
}

function _acctMonthToDate(yearMonth) {
  var parts = String(yearMonth).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
}