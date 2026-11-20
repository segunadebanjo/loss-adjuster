import { fromKobo, percentOf, toKobo } from "./money.js";

/**
 * Fee note maths (CLAUDE.md section 6). Pure, integer kobo.
 *   gross = professional fee + expenses
 *   VAT   = VAT rate x gross
 *   WHT   = WHT rate x professional fee        (withheld by the insurer; not charged on expenses or VAT)
 *   net   = gross + VAT - WHT                  (what the insurer pays the firm)
 */
export interface FeeNoteInput {
  professionalFee: string;
  expenses: Array<{ description: string; amount: string }>;
  vatRate: string;
  whtRate: string;
}

export interface FeeNoteFigures {
  professionalFee: string;
  expensesTotal: string;
  grossAmount: string;
  vatRate: string;
  vatAmount: string;
  invoiceTotal: string;
  whtRate: string;
  whtAmount: string;
  netPayable: string;
}

export function computeFeeNote(input: FeeNoteInput): FeeNoteFigures {
  const fee = toKobo(input.professionalFee);
  const expenses = input.expenses.reduce((sum, e) => sum + toKobo(e.amount), 0n);
  const gross = fee + expenses;
  const vat = percentOf(gross, input.vatRate);
  const wht = percentOf(fee, input.whtRate);
  return {
    professionalFee: fromKobo(fee),
    expensesTotal: fromKobo(expenses),
    grossAmount: fromKobo(gross),
    vatRate: fromKobo(toKobo(input.vatRate)),
    vatAmount: fromKobo(vat),
    invoiceTotal: fromKobo(gross + vat),
    whtRate: fromKobo(toKobo(input.whtRate)),
    whtAmount: fromKobo(wht),
    netPayable: fromKobo(gross + vat - wht),
  };
}
