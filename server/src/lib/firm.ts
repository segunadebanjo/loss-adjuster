import { existsSync } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export interface Firm {
  name: string;
  address: string;
  rcNumber: string;
  naicomLicence: string;
  email: string;
  phone: string;
  tin: string;
  bank: { name: string; accountName: string; accountNumber: string };
  logoPath: string | null;
  /** True while any detail is still a "[placeholder]". */
  placeholders: boolean;
}

export function firm(): Firm {
  const logo = env.FIRM_LOGO_PATH ? path.resolve(env.FIRM_LOGO_PATH) : null;
  const f = {
    name: env.FIRM_NAME,
    address: env.FIRM_ADDRESS,
    rcNumber: env.FIRM_RC_NUMBER,
    naicomLicence: env.FIRM_NAICOM_LICENCE,
    email: env.FIRM_EMAIL,
    phone: env.FIRM_PHONE,
    tin: env.FIRM_TIN,
    bank: { name: env.FIRM_BANK_NAME, accountName: env.FIRM_ACCOUNT_NAME, accountNumber: env.FIRM_ACCOUNT_NUMBER },
    // A missing logo file gives an unbranded document rather than an error.
    logoPath: logo && existsSync(logo) ? logo : null,
  };
  const text = [f.address, f.rcNumber, f.naicomLicence, f.email, f.phone, f.tin, f.bank.name, f.bank.accountName, f.bank.accountNumber].join(" ");
  return { ...f, placeholders: /\[[^\]]*\]/.test(text) };
}
