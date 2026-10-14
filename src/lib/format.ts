const number = (value: number, digits = 2) =>
  value.toLocaleString("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 12'345.60 */
export const formatNumber = number;

/** 12'345.60 CHF */
export const formatMoney = (value: number, currency = "CHF") => `${number(value)} ${currency}`;

/** +1'234.50 bzw. −1'234.50 */
export const formatSigned = (value: number, digits = 2) => (value >= 0 ? `+${number(value, digits)}` : number(value, digits));

/** +3.47 % bzw. −4.00 % */
export const formatPercent = (value: number) => `${formatSigned(value)} %`;
