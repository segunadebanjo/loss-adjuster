import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/AuthContext";
import { ROLE_LABEL } from "@/app/nav";
import { adminApi } from "@/shared/api/admin";
import { queryKeys } from "@/shared/api/claims";
import { errorMessage, fieldErrors } from "@/shared/api/client";
import type { AdminUser, Organisation, Role } from "@/shared/api/types";
import { formatDateTime } from "@/shared/lib/claims";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner } from "@/shared/components/ui";
import { PageHeader } from "@/shared/components/PageHeader";

function UserDialog({ user, organisations, onClose }: { user: AdminUser | null; organisations: Organisation[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    fullName: user?.fullName ?? "",
    email: user?.email ?? "",
    role: (user?.role ?? "ADJUSTER") as Role,
    phone: user?.phone ?? "",
    naicomLicenseNo: user?.naicomLicenseNo ?? "",
    ciiQualification: user?.ciiQualification ?? "",
    organisationId: String(user?.organisationId ?? ""),
    isActive: user?.isActive ?? true,
    password: "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const m = useMutation({
    mutationFn: () => {
      const { password, organisationId, ...rest } = f;
      const body = { ...rest, organisationId: f.role === "INSURER" && organisationId ? Number(organisationId) : null };
      return user ? adminApi.updateUser(user.id, body) : adminApi.createUser({ ...body, password });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users });
      void qc.invalidateQueries({ queryKey: queryKeys.options });
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const staff = f.role !== "INSURER";
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.fullName}` : "Add a user"} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" loading={m.isPending}>{user ? "Save" : "Add user"}</Button></>}>
      <form id="user-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} className="sm:col-span-2" />}
        <Field label="Full name" required error={errs.fullName}>{(id) => <Input id={id} value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} />}</Field>
        <Field label="Email" required error={errs.email}>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
        <Field label="Role" required error={errs.role}>
          {(id) => (
            <Select id={id} value={f.role} onChange={(e) => set({ role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          )}
        </Field>
        {staff ? (
          <Field label="Phone" error={errs.phone}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+234…" />}</Field>
        ) : (
          <Field label="Insurer or broker" required error={errs.organisationId}>
            {(id) => (
              <Select id={id} value={f.organisationId} onChange={(e) => set({ organisationId: e.target.value })}>
                <option value="">Choose…</option>
                {organisations.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type === "INSURER" ? "insurer" : "broker"})</option>)}
              </Select>
            )}
          </Field>
        )}
        {staff && (
          <>
            <Field label="NAICOM licence no." error={errs.naicomLicenseNo}>{(id) => <Input id={id} value={f.naicomLicenseNo} onChange={(e) => set({ naicomLicenseNo: e.target.value })} placeholder="e.g. LA/2018/0455" />}</Field>
            <Field label="CII qualification" error={errs.ciiQualification}>
              {(id) => (
                <Input id={id} list="cii-quals" value={f.ciiQualification} onChange={(e) => set({ ciiQualification: e.target.value })} placeholder="e.g. ACII, AIIN" />
              )}
            </Field>
            <datalist id="cii-quals">
              {["ACII", "FCII", "AIIN", "FIIN", "Cert CII", "Dip CII"].map((q) => <option key={q} value={q} />)}
            </datalist>
          </>
        )}
        {!staff && <Field label="Phone" error={errs.phone}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>}
        {!user && (
          <Field label="Temporary password" required error={errs.password} hint="At least 10 characters. Share it securely; they can't change it themselves yet.">
            {(id, d) => <Input id={id} aria-describedby={d} type="text" autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} />}
          </Field>
        )}
        {user && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="size-4 accent-brand-600" />
            Active (can sign in)
          </label>
        )}
      </form>
    </Modal>
  );
}

function PasswordDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const m = useMutation({ mutationFn: () => adminApi.setPassword(user.id, password), onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={`New password for ${user.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Set password</Button></>}>
      <p className="mb-4 text-sm text-slate-600">They will be signed out everywhere and must sign in with the new password.</p>
      {m.isError && !fieldErrors(m.error).password && <ErrorNote message={errorMessage(m.error)} className="mb-4" />}
      <Field label="New password" error={fieldErrors(m.error).password} hint="At least 10 characters.">{(id, d) => <Input id={id} aria-describedby={d} type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
    </Modal>
  );
}

function OrganisationDialog({ org, onClose }: { org: Organisation | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: org?.name ?? "", type: org?.type ?? "INSURER", naicomLicenceNo: org?.naicomLicenceNo ?? "", email: org?.email ?? "", phone: org?.phone ?? "", address: org?.address ?? "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const m = useMutation({
    mutationFn: () => (org ? adminApi.updateOrganisation(org.id, f) : adminApi.createOrganisation(f)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.organisations });
      void qc.invalidateQueries({ queryKey: queryKeys.options });
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  return (
    <Modal open onClose={onClose} title={org ? `Edit ${org.name}` : "Add an insurer or broker"} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>{org ? "Save" : "Add"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {m.isError && !Object.keys(errs).length && <ErrorNote message={errorMessage(m.error)} className="sm:col-span-2" />}
        <Field label="Name" required error={errs.name}>{(id) => <Input id={id} value={f.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="Type" required error={errs.type}>
          {(id) => (
            <Select id={id} value={f.type} disabled={!!org} onChange={(e) => set({ type: e.target.value as "INSURER" | "BROKER" })}>
              <option value="INSURER">Insurer</option>
              <option value="BROKER">Broker</option>
            </Select>
          )}
        </Field>
        <Field label="NAICOM licence no." error={errs.naicomLicenceNo}>{(id) => <Input id={id} value={f.naicomLicenceNo} onChange={(e) => set({ naicomLicenceNo: e.target.value })} />}</Field>
        <Field label="Claims email" error={errs.email}>{(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
        <Field label="Phone" error={errs.phone}>{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
        <Field label="Address" error={errs.address}>{(id) => <Input id={id} value={f.address} onChange={(e) => set({ address: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState<"users" | "orgs">("users");
  const users = useQuery({ queryKey: queryKeys.users, queryFn: adminApi.users });
  const orgs = useQuery({ queryKey: queryKeys.organisations, queryFn: adminApi.organisations });
  const [editing, setEditing] = useState<AdminUser | null | "new">(null);
  const [pw, setPw] = useState<AdminUser | null>(null);
  const [editingOrg, setEditingOrg] = useState<Organisation | null | "new">(null);

  return (
    <>
      <PageHeader
        title="Users & adjusters"
        description="Staff, loss adjusters and the insurer/broker users who follow their claims."
        actions={
          tab === "users" ? (
            <Button onClick={() => setEditing("new")}><Plus className="size-4" /> Add user</Button>
          ) : (
            <Button onClick={() => setEditingOrg("new")}><Plus className="size-4" /> Add insurer or broker</Button>
          )
        }
      />
      <div role="tablist" className="mb-5 flex gap-1 border-b border-slate-200">
        {([["users", "Users"], ["orgs", "Insurers & brokers"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx("-mb-px min-h-11 border-b-2 px-3 text-sm font-medium", tab === k ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {l}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <Card bodyClassName="p-0">
          {users.isPending ? <Spinner /> : users.isError ? <ErrorNote message={errorMessage(users.error)} className="m-4" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Role</th>
                    <th className="px-3 py-2.5 font-medium">Licence / organisation</th>
                    <th className="px-3 py-2.5 text-right font-medium">Open claims</th>
                    <th className="px-3 py-2.5 font-medium">Last sign-in</th>
                    <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((u) => (
                    <tr key={u.id} className={clsx("border-b border-slate-50 last:border-0", !u.isActive && "text-slate-400")}>
                      <td className="px-5 py-3">
                        <p className="font-medium">{u.fullName}{!u.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">Inactive</span>}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{ROLE_LABEL[u.role]}</td>
                      <td className="px-3 py-3">
                        {u.organisation ? u.organisation.name : [u.ciiQualification, u.naicomLicenseNo].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{u.role === "ADJUSTER" ? u.openClaims : "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-slate-500">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(u)} aria-label={`Edit ${u.fullName}`}><Pencil className="size-3.5" /> Edit</Button>
                          {u.id !== me?.id && <Button variant="ghost" size="sm" onClick={() => setPw(u)} aria-label={`Set password for ${u.fullName}`}><KeyRound className="size-3.5" /> Password</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "orgs" && (
        <Card bodyClassName="p-0">
          {orgs.isPending ? <Spinner /> : orgs.isError ? <ErrorNote message={errorMessage(orgs.error)} className="m-4" /> : orgs.data.length === 0 ? <EmptyState title="No insurers or brokers yet" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2.5 font-medium">Name</th>
                    <th className="px-3 py-2.5 font-medium">Type</th>
                    <th className="px-3 py-2.5 font-medium">NAICOM licence</th>
                    <th className="px-3 py-2.5 font-medium">Contact</th>
                    <th className="px-3 py-2.5 text-right font-medium">Policies</th>
                    <th className="px-3 py-2.5 text-right font-medium">Users</th>
                    <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.data.map((o) => (
                    <tr key={o.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-3 font-medium">{o.name}</td>
                      <td className="px-3 py-3">{o.type === "INSURER" ? "Insurer" : "Broker"}</td>
                      <td className="px-3 py-3">{o.naicomLicenceNo ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-600">{[o.email, o.phone].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{o.policyCount}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{o.userCount}</td>
                      <td className="px-5 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => setEditingOrg(o)}><Pencil className="size-3.5" /> Edit</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {editing && <UserDialog user={editing === "new" ? null : editing} organisations={orgs.data ?? []} onClose={() => setEditing(null)} />}
      {pw && <PasswordDialog user={pw} onClose={() => setPw(null)} />}
      {editingOrg && <OrganisationDialog org={editingOrg === "new" ? null : editingOrg} onClose={() => setEditingOrg(null)} />}
    </>
  );
}
