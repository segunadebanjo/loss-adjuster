export type Role = "ADMIN" | "ADJUSTER" | "INSURER";

export interface User {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  phone: string | null;
  naicomLicenseNo: string | null;
  ciiQualification: string | null;
  organisation: { id: number; name: string; type: "INSURER" | "BROKER" } | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> | unknown };
}
