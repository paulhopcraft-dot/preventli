/**
 * WorkSafeVicTemplateView
 *
 * Renders an RTW plan in the layout of WorkSafe Victoria's "Return to Work
 * Arrangements (Includes Proposed Suitable or Pre-Injury Employment)" form.
 *
 * The internal `PlanDetailView` remains the in-app working view. This view is
 * intended for print / sign-off — it mirrors the WorkSafe template so the
 * employer can hand a familiar-looking document to the worker, GP and insurer.
 *
 * Template reference: .planning/worksafe-vic-rtw-template.pdf (Kamal Vinod
 * example, Aug 2022).
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";

interface Props {
  planId: string;
}

interface ScheduleWeek {
  weekNumber: number;
  hoursPerDay: number;
  daysPerWeek: number;
}

interface DutyRow {
  dutyId: string;
  dutyName: string;
  dutyDescription: string | null;
  suitability: string;
  modificationNotes: string | null;
  isIncluded: boolean;
  excludedReason: string | null;
}

interface PlanDetailsResponse {
  success: boolean;
  data: {
    plan: {
      id: string;
      caseId: string;
      roleId: string;
      planType: string;
      status: string;
      startDate: string;
      restrictionReviewDate: string | null;
      createdAt?: string | null;
    };
    schedule: ScheduleWeek[];
    duties: DutyRow[];
    workerCase: {
      id: string;
      workerName: string;
      company: string;
      dateOfInjury: string;
      workStatus: string;
      claimNumber?: string | null;
    } | null;
    role: {
      id: string;
      name: string;
      description: string | null;
    } | null;
    restrictions: Array<{
      category: string;
      capability: string;
      notes?: string | null;
    }> | null;
  };
}

interface CaseContact {
  id: string;
  role: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
}

interface CaseContactsResponse {
  data: { contacts: CaseContact[] };
}

function formatDateAU(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function weekStartLabel(planStart: string, weekNumber: number): string {
  if (!planStart) return "—";
  const start = new Date(planStart);
  if (isNaN(start.getTime())) return "—";
  start.setDate(start.getDate() + (weekNumber - 1) * 7);
  return start.toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dayWindow(hoursPerDay: number): string {
  if (!hoursPerDay || hoursPerDay <= 0) return "—";
  // Demo display: 9am start, end-time = 9 + hours.
  const endHour = 9 + Math.round(hoursPerDay);
  const endLabel = endHour > 12 ? `${endHour - 12}pm` : `${endHour}am`;
  return `9am-${endLabel}`;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function CategoryLabel(category: string): string {
  return category
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CapabilityLabel(capability: string): string {
  switch (capability) {
    case "cannot":
      return "Avoid";
    case "with_modifications":
      return "With modifications";
    case "can":
      return "Can perform";
    default:
      return "Not assessed";
  }
}

export function WorkSafeVicTemplateView({ planId }: Props): React.JSX.Element {
  const { data, isLoading, error } = useQuery<PlanDetailsResponse>({
    queryKey: ["rtw-plan-detail", planId],
    queryFn: async () => {
      const res = await fetch(`/api/rtw-plans/${planId}/details`);
      if (!res.ok) throw new Error("Failed to load plan");
      return res.json();
    },
    enabled: !!planId,
  });

  const caseId = data?.data?.plan?.caseId;
  const { data: contacts } = useQuery<CaseContactsResponse>({
    queryKey: [`/api/cases/${caseId}/contacts`],
    enabled: !!caseId,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading plan…</span>
      </div>
    );
  }
  if (error || !data?.data) {
    return (
      <div className="p-6 text-sm text-red-700 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Unable to render WorkSafe Vic template for this plan.
      </div>
    );
  }

  const { plan, schedule, duties, workerCase, role, restrictions } = data.data;
  const included = duties.filter((d) => d.isIncluded);
  const excluded = duties.filter((d) => !d.isIncluded);
  const modifications = included
    .filter((d) => !!d.modificationNotes)
    .map((d) => `${d.dutyName} — ${d.modificationNotes}`);

  const contactsList = contacts?.data?.contacts ?? [];
  const findByRole = (r: string): CaseContact | undefined =>
    contactsList.find((c) => c.role === r);
  const gp = findByRole("treating_gp");
  const specialist = findByRole("specialist");
  const physio = findByRole("physiotherapist");
  const rtwCoordinator = findByRole("case_manager");
  const employer = findByRole("employer_primary");

  const restrictionsText =
    restrictions && restrictions.length > 0
      ? restrictions
          .filter((r) => r.capability !== "can" && r.capability !== "not_assessed")
          .map((r) => `${CategoryLabel(r.category)}: ${CapabilityLabel(r.capability)}${r.notes ? ` — ${r.notes}` : ""}`)
          .join("; ")
      : "—";

  const restrictionDateRange =
    workerCase?.dateOfInjury && plan.restrictionReviewDate
      ? `${formatDateAU(workerCase.dateOfInjury)} to ${formatDateAU(plan.restrictionReviewDate)}`
      : "—";

  const arrangementNumber = plan.id.slice(0, 8).toUpperCase();
  const datePrepared = formatDateAU(plan.createdAt ?? plan.startDate);

  return (
    <article className="bg-white text-black p-8 print:p-0 max-w-[210mm] mx-auto font-sans text-[12px] leading-snug">
      {/* ── Title ────────────────────────────────────────────────────────── */}
      <header className="text-center mb-3">
        <h1 className="text-2xl font-bold text-cyan-700">Return to Work Arrangements</h1>
        <p className="text-sm font-semibold">
          Includes Proposed Suitable or Pre-Injury Employment
        </p>
      </header>
      <p className="text-[11px] text-gray-700 italic mb-4 leading-snug">
        Note: These return to work arrangements are not a new employment contract. These
        arrangements will be reviewed over time to ensure that the duties and hours are consistent
        with your capacity for work and are helping to progress your return to work.
      </p>

      {/* ── Details — Confidential ───────────────────────────────────────── */}
      <h2 className="text-base font-bold text-cyan-700 mb-1">Details - Confidential</h2>
      <table className="w-full border-collapse mb-3 text-[12px]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-1 text-left w-1/3">Arrangement #</th>
            <th className="border border-gray-300 px-2 py-1 text-left">Date Prepared</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-300 px-2 py-1">{arrangementNumber}</td>
            <td className="border border-gray-300 px-2 py-1">{datePrepared}</td>
          </tr>
        </tbody>
      </table>

      <p className="mb-1 text-[12px]">These return to work arrangements are for:</p>
      <table className="w-full border-collapse mb-3 text-[12px]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-1 text-left w-1/2">Name of worker</th>
            <th className="border border-gray-300 px-2 py-1 text-left">WorkSafe claim number</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-300 px-2 py-1">{workerCase?.workerName ?? "—"}</td>
            <td className="border border-gray-300 px-2 py-1">{workerCase?.claimNumber ?? "—"}</td>
          </tr>
        </tbody>
      </table>

      <p className="mb-1 text-[12px]">Pre-Injury work:</p>
      <table className="w-full border-collapse mb-3 text-[12px]">
        <tbody>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-1 text-left w-1/2">Job title</th>
            <th className="border border-gray-300 px-2 py-1 text-left">Days/hours of work</th>
          </tr>
          <tr>
            <td className="border border-gray-300 px-2 py-1">{role?.name ?? "—"}</td>
            <td className="border border-gray-300 px-2 py-1">Mon-Fri (as detailed in schedule below)</td>
          </tr>
          <tr>
            <td className="border border-gray-300 px-2 py-1 font-semibold" colSpan={2}>
              Location
            </td>
          </tr>
          <tr>
            <td className="border border-gray-300 px-2 py-1" colSpan={2}>
              {employer?.company ?? workerCase?.company ?? "—"} — site locations as required by role
            </td>
          </tr>
          <tr>
            <td className="border border-gray-300 px-2 py-1 font-semibold" colSpan={2}>
              Name of employer
            </td>
          </tr>
          <tr>
            <td className="border border-gray-300 px-2 py-1" colSpan={2}>
              {workerCase?.company ?? "—"}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Return to Work Arrangements ──────────────────────────────────── */}
      <h2 className="text-base font-bold text-cyan-700 mb-1 mt-4">Return to Work Arrangements</h2>

      <section className="mb-3 border border-gray-300">
        <p className="bg-gray-100 px-2 py-1 font-semibold">Duties or tasks to be undertaken</p>
        <p className="px-2 py-1 italic text-[11px] text-gray-700">
          Describe the specific duties and tasks required. Include physical and other requirements,
          e.g. lifting, sitting, rotation etc.
        </p>
        <ul className="list-disc pl-6 px-2 py-2 space-y-0.5">
          {included.length === 0 ? (
            <li className="italic text-gray-700">No proposed duties on file.</li>
          ) : (
            included.map((d) => (
              <li key={d.dutyId}>
                <span className="font-medium">{d.dutyName}</span>
                {d.dutyDescription ? ` — ${d.dutyDescription}` : ""}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="mb-3 border border-gray-300">
        <p className="bg-gray-100 px-2 py-1 font-semibold">
          Workplace supports, aids or modifications to be provided
        </p>
        <p className="px-2 py-1 italic text-[11px] text-gray-700">
          Describe workplace supports, aids or modifications, e.g. rest breaks, buddy system,
          special equipment, training, etc.
        </p>
        <ul className="list-disc pl-6 px-2 py-2 space-y-0.5">
          {modifications.length === 0 ? (
            <>
              <li>Suitable work duties tailored to the worker's current capacity.</li>
              <li>Rest breaks scheduled in line with restriction tolerance.</li>
              <li>Workstation adjustments and ergonomic supports as required.</li>
            </>
          ) : (
            modifications.map((m, i) => <li key={i}>{m}</li>)
          )}
        </ul>
      </section>

      <section className="mb-3 border border-gray-300">
        <p className="bg-gray-100 px-2 py-1 font-semibold">Specific duties or tasks to be avoided</p>
        <p className="px-2 py-1 italic text-[11px] text-gray-700">
          Describe the specific duties and tasks that are to be avoided, e.g. no loading pallets,
          no lifting overhead etc.
        </p>
        <ul className="list-[square] pl-6 px-2 py-2 space-y-0.5">
          {excluded.length === 0 ? (
            <li className="italic text-gray-700">No duties identified as out-of-scope at this stage.</li>
          ) : (
            excluded.map((d) => (
              <li key={d.dutyId}>
                {d.dutyName}
                {d.excludedReason ? ` — ${d.excludedReason}` : ""}
              </li>
            ))
          )}
        </ul>
      </section>

      {/* ── Medical restrictions ─────────────────────────────────────────── */}
      <section className="mb-3 border border-gray-300">
        <p className="bg-gray-100 px-2 py-1 font-semibold">Medical restrictions</p>
        <p className="px-2 py-1 italic text-[11px] text-gray-700">
          Describe the restrictions on the most recent Certificate of Capacity or from other
          sources. From what date or period(s) do these restrictions apply?
        </p>
        <p className="px-2 py-2 text-[12px]">
          As per Certificate of Capacity {restrictionDateRange}. {restrictionsText}.
        </p>
      </section>

      {/* ── Hours of work ────────────────────────────────────────────────── */}
      <h2 className="text-base font-bold text-cyan-700 mb-1 mt-4">Hours of work</h2>
      <p className="italic text-[11px] text-gray-700 mb-2">
        It is recommended that reduced hours are gradually increased where appropriate.
      </p>
      {schedule.slice(0, 4).map((week) => {
        const window = dayWindow(Number(week.hoursPerDay));
        const totalPerWeek =
          Number(week.hoursPerDay) * Number(week.daysPerWeek);
        return (
          <table key={week.weekNumber} className="w-full border-collapse mb-2 text-[12px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1 text-left w-[15%]">
                  Week {week.weekNumber}
                </th>
                {DAYS.map((d) => (
                  <th key={d} className="border border-gray-300 px-2 py-1 text-left">
                    {d}
                  </th>
                ))}
                <th className="border border-gray-300 px-2 py-1 text-left">Total p/w</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 px-2 py-1">
                  {weekStartLabel(plan.startDate, week.weekNumber)}
                </td>
                {DAYS.map((d, i) => (
                  <td key={d} className="border border-gray-300 px-2 py-1">
                    {i < week.daysPerWeek ? window : ""}
                  </td>
                ))}
                <td className="border border-gray-300 px-2 py-1 font-semibold">
                  {totalPerWeek}
                </td>
              </tr>
            </tbody>
          </table>
        );
      })}

      {/* ── Coordinator block ────────────────────────────────────────────── */}
      <table className="w-full border-collapse mt-4 mb-3 text-[12px]">
        <tbody>
          <tr>
            <td className="border border-gray-300 bg-gray-100 px-2 py-1 font-semibold w-1/3">
              Work location
            </td>
            <td className="border border-gray-300 px-2 py-1">
              {employer?.company ?? workerCase?.company ?? "—"} sites
            </td>
            <td className="border border-gray-300 bg-gray-100 px-2 py-1 font-semibold w-[18%]">
              Start date:
            </td>
            <td className="border border-gray-300 px-2 py-1 w-[18%]">
              {formatDateAU(plan.startDate)}
            </td>
          </tr>
          <tr>
            <td className="border border-gray-300 bg-gray-100 px-2 py-1 font-semibold">
              Supervisor <em className="text-[10px] font-normal">(name, position, phone)</em>
            </td>
            <td className="border border-gray-300 px-2 py-1">
              {rtwCoordinator?.name ?? "—"}
              {rtwCoordinator?.phone ? ` · ${rtwCoordinator.phone}` : ""}
            </td>
            <td className="border border-gray-300 bg-gray-100 px-2 py-1 font-semibold">
              Review date:
            </td>
            <td className="border border-gray-300 px-2 py-1">
              {formatDateAU(plan.restrictionReviewDate)}
            </td>
          </tr>
          <tr>
            <td className="border border-gray-300 bg-gray-100 px-2 py-1 font-semibold">
              Prepared by <em className="text-[10px] font-normal">(name, position, phone)</em>
            </td>
            <td className="border border-gray-300 px-2 py-1">
              {employer?.name ?? "—"}
              {employer?.phone ? ` · ${employer.phone}` : ""}
            </td>
            <td className="border border-gray-300 bg-gray-100 px-2 py-1 font-semibold">
              Date prepared
            </td>
            <td className="border border-gray-300 px-2 py-1">{datePrepared}</td>
          </tr>
        </tbody>
      </table>

      {/* ── Signatures ──────────────────────────────────────────────────── */}
      <h2 className="text-base font-bold text-cyan-700 mb-1 mt-4">
        Signature of key people involved
      </h2>
      {[
        {
          role: "Worker",
          rolePrompt: "I will participate in these return to work arrangements.",
          name: workerCase?.workerName,
          phone: "—",
        },
        {
          role: "Return to Work Coordinator",
          rolePrompt: "I will monitor and review these return to work arrangements.",
          name: rtwCoordinator?.name ?? employer?.name,
          phone: rtwCoordinator?.phone ?? employer?.phone ?? "—",
        },
        {
          role: "Supervisor",
          rolePrompt: "I will implement these return to work arrangements in the work area.",
          name: rtwCoordinator?.name,
          phone: rtwCoordinator?.phone ?? "—",
        },
        {
          role: "Doctor",
          rolePrompt: "These return to work arrangements are consistent with the worker's capacity.",
          name: gp?.name ?? specialist?.name,
          phone: gp?.phone ?? specialist?.phone ?? "—",
        },
        {
          role: physio ? "Physiotherapist" : "Allied Health",
          rolePrompt:
            "These return to work arrangements are consistent with the worker's capacity.",
          name: physio?.name,
          phone: physio?.phone ?? "—",
        },
      ].map((row) => (
        <table key={row.role} className="w-full border-collapse mb-2 text-[12px]">
          <tbody>
            <tr>
              <td className="border border-gray-300 bg-gray-50 px-2 py-1 font-semibold" colSpan={4}>
                <span>{row.role}</span>{" "}
                <em className="text-[11px] font-normal">— {row.rolePrompt}</em>
              </td>
            </tr>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-1 text-left w-1/4">Name</th>
              <th className="border border-gray-300 px-2 py-1 text-left w-1/4">Phone</th>
              <th className="border border-gray-300 px-2 py-1 text-left w-1/4">Signed</th>
              <th className="border border-gray-300 px-2 py-1 text-left w-1/4">Date</th>
            </tr>
            <tr>
              <td className="border border-gray-300 px-2 py-1 h-7">{row.name ?? ""}</td>
              <td className="border border-gray-300 px-2 py-1">{row.phone}</td>
              <td className="border border-gray-300 px-2 py-1"></td>
              <td className="border border-gray-300 px-2 py-1"></td>
            </tr>
          </tbody>
        </table>
      ))}

      <h2 className="text-base font-bold text-cyan-700 mb-1 mt-4">Notes/additional information</h2>
      <p className="italic text-[11px] text-gray-700 mb-2">
        If there is any additional information you wish to include in this form, please attach any
        supporting documentation e.g. medical reports, position description, photos etc.
      </p>
      <div className="border border-gray-300 min-h-[60px] mb-4"></div>

      <p className="text-right text-[10px] text-gray-600 mt-6">
        Generated by Preventli — based on WorkSafe Victoria Return to Work Arrangements template.
      </p>
    </article>
  );
}

export default WorkSafeVicTemplateView;
