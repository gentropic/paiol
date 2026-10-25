// Straight-line managerial depreciation. An asset enters the calculation on the day it is
// available for use, not on the day it is paid. The useful life is entered in months; a
// partial reporting period receives its proportional share of calendar days.

const dayMs = 86400000;
const assetDay = (value) => String(value || '').slice(0, 10);
const utc = (value) => {
  const text = assetDay(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  return Date.parse(`${text}T00:00:00Z`);
};

export function assetDepreciation(asset, start, end) {
  const cost = Number(asset.cost) || 0;
  const residual = Number(asset.residualValue) || 0;
  const months = Number(asset.usefulMonths) || 0;
  const inUse = utc(asset.inUseDate);
  const rangeStart = utc(start);
  const rangeEnd = utc(end);
  if (asset.archived || !(cost > residual) || !(months > 0) || !Number.isInteger(months)
      || !Number.isFinite(inUse) || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return 0;
  const date = new Date(inUse);
  const monthIndex = date.getUTCMonth() + months;
  const years = date.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(years, month + 1, 0)).getUTCDate();
  const endUse = Date.UTC(years, month, Math.min(date.getUTCDate(), lastDay));
  const stop = Number.isFinite(utc(asset.disposalDate)) ? Math.min(endUse, utc(asset.disposalDate)) : endUse;
  const overlap = Math.max(0, Math.min(rangeEnd + dayMs, stop) - Math.max(rangeStart, inUse));
  return overlap > 0 ? ((cost - residual) * overlap) / (endUse - inUse) : 0;
}

export function depreciationSummary(store, start, end) {
  const rows = (store.state.assets || []).map((asset) => ({ asset, amount: assetDepreciation(asset, start, end) }))
    .filter((row) => row.amount > 0);
  const production = rows.filter((row) => row.asset.use === 'producao').reduce((sum, row) => sum + row.amount, 0);
  const administration = rows.reduce((sum, row) => sum + row.amount, 0) - production;
  return { rows, production, administration, total: production + administration };
}
