import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api.js";
import CoachesPagination from "../components/CoachesPagination.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { formatDuration, hoursToMinutes } from "../utils/formatDuration.js";

function downloadCSV(filename, rows) {
  if (!Array.isArray(rows) || rows.length <= 1) {
    throw new Error("No data available to export");
  }

  const processRow = (row) => row.map((item) => `"${item ?? ""}"`).join(",");

  const csvContent = rows.map(processRow).join("\n");

  const BOM = "\uFEFF";

  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getErrorMessage(err) {
  const msg = err?.response?.data?.message;
  if (typeof msg === "string") return msg;
  return "Something went wrong";
}

function isArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text ?? ""));
}

function formatDateOnly(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const [y, m, day] = raw.split("-");
  return `${day}/${m}/${y}`;
}

function formatTo12Hour(time) {
  if (!time || !String(time).includes(":")) return time;

  const [hours, minutes] = String(time).split(":");
  const h = Number(hours);

  if (Number.isNaN(h)) return time;

  const period = h >= 12 ? "PM" : "AM";
  const formattedHour = h % 12 || 12;

  return `${formattedHour}:${minutes} ${period}`;
}

function formatSessionSchedule(session) {
  const slots = Array.isArray(session?.schedule) ? session.schedule : [];
  if (!slots.length) return "No schedule";
  const first = slots[0];
  return `${first.day} ${formatTo12Hour(first.startTime)} - ${formatTo12Hour(
    first.endTime
  )}`;
}

function monthToDateRange(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(String(monthValue ?? "").trim())) {
    return null;
  }
  const [yearStr, monthStr] = String(monthValue).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || month < 1 || month > 12) return null;
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const toDateOnly = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  return {
    startDate: toDateOnly(first),
    endDate: toDateOnly(last),
  };
}

export default function AttendancePage() {
  const [attendanceTab, setAttendanceTab] = useState("coach");

  const [records, setRecords] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [trainees, setTrainees] = useState([]);

  const [traineeRecords, setTraineeRecords] = useState([]);
  const [traineePage, setTraineePage] = useState(1);
  const [traineeLimit, setTraineeLimit] = useState(10);
  const [traineeTotalItems, setTraineeTotalItems] = useState(0);
  const [traineeTotalPages, setTraineeTotalPages] = useState(1);
  const [traineeLoading, setTraineeLoading] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [coachId, setCoachId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [traineeStartDate, setTraineeStartDate] = useState("");
  const [traineeEndDate, setTraineeEndDate] = useState("");
  const [traineeFilterId, setTraineeFilterId] = useState("");
  const [traineeCoachId, setTraineeCoachId] = useState("");
  const [traineeSessionId, setTraineeSessionId] = useState("");
  const [traineeStatusFilter, setTraineeStatusFilter] = useState("all");
  const [payrollStartDate, setPayrollStartDate] = useState("");
  const [payrollEndDate, setPayrollEndDate] = useState("");
  const [payrollMonth, setPayrollMonth] = useState("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearSubmitting, setClearSubmitting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsNote, setDetailsNote] = useState("");
  const detailsNoteIsArabic = isArabic(detailsNote);

  function handleExportTraineeAttendance() {
    try {
      setError(null);
      setSuccessMessage(null);

      if (!traineeRecords.length) {
        setError("No trainee attendance data found to export.");
        return;
      }

      const rows = [
        ["Date", "Trainee", "Day", "Coach", "Session", "Time", "Status"],
        ...traineeRecords.map((r) => [
          r.date,
          r.traineeId?.name || "",
          r.dayName || "",
          r.coachId?.name || "",
          formatSessionSchedule(r.sessionId),
          `${formatTo12Hour(r.startTime)} - ${formatTo12Hour(r.endTime)}`,
          r.attended === false ? "Absent" : "Present",
        ]),
      ];

      const today = new Date().toISOString().split("T")[0];
      downloadCSV(`trainee-attendance-${today}.csv`, rows);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function handleExportAttendance() {
    try {
      setError(null);
      setSuccessMessage(null);

      if (!records.length) {
        setError("No attendance data found to export.");
        return;
      }

      const rows = [
        ["Date", "Coach", "Session", "Time", "Duration"],
        ...records.map((r) => [
          r.date,
          r.coachId?.name || "",
          formatSessionSchedule(r.sessionId),
          `${formatTo12Hour(r.startTime)} - ${formatTo12Hour(r.endTime)}`,
          formatDuration(r.durationMinutes ?? hoursToMinutes(r.durationHours)),
        ]),
      ];

      const today = new Date().toISOString().split("T")[0];
      downloadCSV(`attendance-${today}.csv`, rows);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function handleExportPayroll() {
    try {
      setError(null);
      setSuccessMessage(null);

      if (!payroll.length) {
        setError("No payroll data found to export.");
        return;
      }

      const rows = [
        ["Coach Name", "Total Duration"],
        ...payroll.map((c) => [
          c.coachName,
          formatDuration(c.totalMinutes ?? hoursToMinutes(c.totalHours)),
        ]),
      ];

      const today = new Date().toISOString().split("T")[0];
      downloadCSV(`payroll-${today}.csv`, rows);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const loadReferences = useCallback(async () => {
    try {
      const [coachesRes, sessionsRes, traineesRes] = await Promise.all([
        api.get("/api/coaches", {
          params: { page: 1, limit: 200, sortBy: "name", order: "asc" },
        }),
        api.get("/api/sessions", {
          params: { page: 1, limit: 300, sortBy: "createdAt", order: "desc" },
        }),
        api.get("/api/trainees", {
          params: { page: 1, limit: 400, sortBy: "name", order: "asc" },
        }),
      ]);

      setCoaches(
        Array.isArray(coachesRes.data?.coaches) ? coachesRes.data.coaches : []
      );
      setSessions(
        Array.isArray(sessionsRes.data?.sessions)
          ? sessionsRes.data.sessions
          : []
      );
      setTrainees(
        Array.isArray(traineesRes.data?.trainees)
          ? traineesRes.data.trainees
          : []
      );
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  const queryParams = useMemo(
    () => ({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      coachId: coachId || undefined,
      sessionId: sessionId || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [startDate, endDate, coachId, sessionId, statusFilter]
  );

  const traineeQueryParams = useMemo(
    () => ({
      startDate: traineeStartDate || undefined,
      endDate: traineeEndDate || undefined,
      coachId: traineeCoachId || undefined,
      sessionId: traineeSessionId || undefined,
      traineeId: traineeFilterId || undefined,
      status: traineeStatusFilter === "all" ? undefined : traineeStatusFilter,
    }),
    [
      traineeStartDate,
      traineeEndDate,
      traineeCoachId,
      traineeSessionId,
      traineeFilterId,
      traineeStatusFilter,
    ]
  );

  const payrollQueryParams = useMemo(
    () => ({
      startDate: payrollStartDate || undefined,
      endDate: payrollEndDate || undefined,
    }),
    [payrollStartDate, payrollEndDate]
  );

  const loadAttendanceHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/api/attendance/history", {
        params: {
          ...queryParams,
          page,
          limit,
        },
      });

      setRecords(Array.isArray(data?.records) ? data.records : []);
      setTotalItems(Number(data?.totalItems) || 0);
      setTotalPages(Number(data?.totalPages) || 1);
      const resolvedPage = Number(data?.currentPage) || page;
      if (resolvedPage !== page) {
        setPage(resolvedPage);
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setRecords([]);
      setTotalItems(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [queryParams, page, limit]);

  const loadTraineeAttendanceHistory = useCallback(async () => {
    setTraineeLoading(true);
    setError(null);
    try {
      const { data } = await api.get("/api/attendance/trainees/history", {
        params: {
          ...traineeQueryParams,
          page: traineePage,
          limit: traineeLimit,
        },
      });

      setTraineeRecords(Array.isArray(data?.records) ? data.records : []);
      setTraineeTotalItems(Number(data?.totalItems) || 0);
      setTraineeTotalPages(Number(data?.totalPages) || 1);
      const resolvedPage = Number(data?.currentPage) || traineePage;
      if (resolvedPage !== traineePage) {
        setTraineePage(resolvedPage);
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setTraineeRecords([]);
      setTraineeTotalItems(0);
      setTraineeTotalPages(1);
    } finally {
      setTraineeLoading(false);
    }
  }, [traineeQueryParams, traineePage, traineeLimit]);

  const loadPayrollSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const { data } = await api.get("/api/attendance/payroll-summary", {
        params: payrollQueryParams,
      });
      setPayroll(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
      setPayroll([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [payrollQueryParams]);

  useEffect(() => {
    loadReferences();
  }, [loadReferences]);

  useEffect(() => {
    loadAttendanceHistory();
  }, [loadAttendanceHistory]);

  useEffect(() => {
    loadTraineeAttendanceHistory();
  }, [loadTraineeAttendanceHistory]);

  useEffect(() => {
    loadPayrollSummary();
  }, [loadPayrollSummary]);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, coachId, sessionId, statusFilter, limit]);

  useEffect(() => {
    setTraineePage(1);
  }, [
    traineeStartDate,
    traineeEndDate,
    traineeCoachId,
    traineeSessionId,
    traineeFilterId,
    traineeStatusFilter,
    traineeLimit,
  ]);

  const emptyHint = loading
    ? "Loading attendance..."
    : "No attendance records for this date range.";

  const traineeEmptyHint = traineeLoading
    ? "Loading trainee attendance..."
    : "No trainee attendance records for this date range.";

  function handlePayrollMonthChange(value) {
    setPayrollMonth(value);
    const range = monthToDateRange(value);
    if (!range) {
      setPayrollStartDate("");
      setPayrollEndDate("");
      return;
    }
    setPayrollStartDate(range.startDate);
    setPayrollEndDate(range.endDate);
  }

  async function confirmClearAttendance() {
    setClearSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const endpoint =
        attendanceTab === "coach"
          ? "/api/attendance/clear/coaches"
          : "/api/attendance/clear/trainees";

      const { data } = await api.delete(endpoint);

      if (attendanceTab === "coach") {
        await Promise.all([loadAttendanceHistory(), loadPayrollSummary()]);
      } else {
        await loadTraineeAttendanceHistory();
      }

      setClearOpen(false);

      setSuccessMessage(
        data?.message ||
          (attendanceTab === "coach"
            ? "Coach attendance cleared"
            : "Trainee attendance cleared")
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setClearSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-4 md:space-y-6">
      {error && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-amber-100">
          <span>{error}</span>

          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-4 flex h-8 w-8 items-center justify-center rounded-full text-amber-200 transition hover:bg-amber-500/20 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between rounded-2xl border border-cyan-500/35 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
          <span>{successMessage}</span>

          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="ml-4 flex h-8 w-8 items-center justify-center rounded-full text-cyan-200 transition hover:bg-cyan-500/20 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      <section className="toolbar-strip">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">
              Attendance
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Switch between coach payroll attendance and trainee session
              attendance.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 rounded-2xl border border-white/5 bg-slate-950/45 p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => setAttendanceTab("coach")}
              className={`flex-1 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition sm:flex-none ${
                attendanceTab === "coach"
                  ? "bg-sky-500/20 text-sky-100 shadow-inner shadow-sky-500/10"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Coach attendance
            </button>
            <button
              type="button"
              onClick={() => setAttendanceTab("trainee")}
              className={`flex-1 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition sm:flex-none ${
                attendanceTab === "trainee"
                  ? "bg-cyan-500/20 text-cyan-100 shadow-inner shadow-cyan-500/10"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Trainee attendance
            </button>
          </div>
        </div>
      </section>

      {attendanceTab === "coach" ? (
        <>
          <section className="toolbar-strip">
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-6">
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input-field !mt-0"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">End date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input-field !mt-0"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Coach</span>
                <select
                  value={coachId}
                  onChange={(e) => setCoachId(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="">All coaches</option>
                  {coaches.map((coach) => (
                    <option key={coach._id} value={coach._id}>
                      {coach.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Session group</span>
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="">All sessions</option>
                  {sessions.map((session) => (
                    <option key={session._id} value={session._id}>
                      {formatSessionSchedule(session)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="all">All</option>
                  <option value="attended">Attended</option>
                  <option value="not_attended">Not attended</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Rows per page</span>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value) || 10)}
                  className="input-field-select !mt-0"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>

            <div className="flex w-full flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleExportAttendance}
                className="btn-primary w-full sm:w-auto"
              >
                Export attendance CSV
              </button>
              <button
                type="button"
                onClick={handleExportPayroll}
                className="btn-secondary w-full border-cyan-500/35 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15 sm:w-auto"
              >
                Export payroll CSV
              </button>
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                disabled={clearSubmitting || loading || summaryLoading}
                className="btn-secondary w-full border-red-500/45 bg-red-950/35 text-red-100 hover:border-red-400/60 hover:bg-red-950/55 sm:w-auto"
              >
                {clearSubmitting ? "Clearing..." : "Clear Attendance Data"}
              </button>
            </div>
          </section>

          <section className="table-shell">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700/50 text-sm">
                <thead className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-4 font-medium">Date</th>
                    <th className="px-4 py-4 font-medium">Coach</th>
                    <th className="px-4 py-4 font-medium">Session</th>
                    <th className="px-4 py-4 font-medium">Duration</th>
                    <th className="px-4 py-4 font-medium">Status</th>
                    <th className="px-4 py-4 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/40">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-5 py-4">
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                      </tr>
                    ))
                  ) : records.length ? (
                    records.map((record) => (
                      <tr
                        key={record._id}
                        className="table-row-hover odd:bg-slate-900/15 even:bg-transparent"
                      >
                        <td className="px-5 py-4 text-slate-200">
                          {formatDateOnly(record.date)}
                        </td>
                        <td className="px-5 py-4 text-slate-200">
                          {record.coachId?.name ?? "—"}
                        </td>
                        <td className="px-5 py-4 text-slate-300">
                          {formatSessionSchedule(record.sessionId)}
                        </td>
                        <td className="px-5 py-4 text-slate-200">
                          {formatDuration(
                            record.durationMinutes ??
                              hoursToMinutes(record.durationHours)
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {record.attended === false ? (
                            <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-3 py-1 text-xs font-medium text-red-200">
                              ✕ Not attended
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                              ✓ Attended
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {record.attended === false ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDetailsNote(
                                  record.reason?.trim() ||
                                    record.note?.trim() ||
                                    "No reason provided."
                                );
                                setDetailsOpen(true);
                              }}
                              className="rounded-xl border border-red-500/30 bg-red-950/25 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-950/40"
                            >
                              Details
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="px-5 py-12 text-center text-slate-500"
                        colSpan={6}
                      >
                        {emptyHint}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <CoachesPagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            limit={limit}
            loading={loading}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          />

          <section className="card-float space-y-4">
            <div className="flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">
                Payroll summary
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-2 text-sm">
                  <span className="text-slate-400">Month</span>
                  <input
                    type="month"
                    value={payrollMonth}
                    onChange={(e) => handlePayrollMonthChange(e.target.value)}
                    className="input-field !mt-0"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-400">Payroll start date</span>
                  <input
                    type="date"
                    value={payrollStartDate}
                    onChange={(e) => {
                      setPayrollMonth("");
                      setPayrollStartDate(e.target.value);
                    }}
                    className="input-field !mt-0"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-400">Payroll end date</span>
                  <input
                    type="date"
                    value={payrollEndDate}
                    onChange={(e) => {
                      setPayrollMonth("");
                      setPayrollEndDate(e.target.value);
                    }}
                    className="input-field !mt-0"
                  />
                </label>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-700/50">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-700/50 text-sm">
                  <thead className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-4 font-medium">Coach name</th>
                      <th className="px-4 py-4 font-medium">Total time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/40">
                    {summaryLoading ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <tr key={index} className="animate-pulse">
                          <td className="px-5 py-4">
                            <div className="h-4 rounded bg-slate-800" />
                          </td>
                          <td className="px-5 py-4">
                            <div className="h-4 rounded bg-slate-800" />
                          </td>
                        </tr>
                      ))
                    ) : payroll.length ? (
                      payroll.map((item) => (
                        <tr
                          key={String(item.coachId)}
                          className="table-row-hover odd:bg-slate-900/15 even:bg-transparent"
                        >
                          <td className="px-5 py-4 text-slate-200">
                            {item.coachName}
                          </td>
                          <td className="px-5 py-4 text-sky-100">
                            {formatDuration(
                              item.totalMinutes ??
                                hoursToMinutes(item.totalHours)
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          className="px-5 py-12 text-center text-slate-500"
                          colSpan={2}
                        >
                          No payroll data for the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="toolbar-strip">
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Start date</span>
                <input
                  type="date"
                  value={traineeStartDate}
                  onChange={(e) => setTraineeStartDate(e.target.value)}
                  className="input-field !mt-0"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">End date</span>
                <input
                  type="date"
                  value={traineeEndDate}
                  onChange={(e) => setTraineeEndDate(e.target.value)}
                  className="input-field !mt-0"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Trainee</span>
                <select
                  value={traineeFilterId}
                  onChange={(e) => setTraineeFilterId(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="">All trainees</option>
                  {trainees.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Coach</span>
                <select
                  value={traineeCoachId}
                  onChange={(e) => setTraineeCoachId(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="">All coaches</option>
                  {coaches.map((coach) => (
                    <option key={coach._id} value={coach._id}>
                      {coach.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Session group</span>
                <select
                  value={traineeSessionId}
                  onChange={(e) => setTraineeSessionId(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="">All sessions</option>
                  {sessions.map((session) => (
                    <option key={session._id} value={session._id}>
                      {formatSessionSchedule(session)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Status</span>
                <select
                  value={traineeStatusFilter}
                  onChange={(e) => setTraineeStatusFilter(e.target.value)}
                  className="input-field-select !mt-0"
                >
                  <option value="all">All</option>
                  <option value="attended">Present</option>
                  <option value="not_attended">Absent</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="text-slate-400">Rows per page</span>
                <select
                  value={traineeLimit}
                  onChange={(e) =>
                    setTraineeLimit(Number(e.target.value) || 10)
                  }
                  className="input-field-select !mt-0"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>

            <div className="flex w-full flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleExportTraineeAttendance}
                className="btn-primary w-full sm:w-auto"
              >
                Export trainee CSV
              </button>
              <button
                type="button"
                onClick={() => setClearOpen(true)}
                disabled={clearSubmitting || traineeLoading}
                className="btn-secondary w-full border-red-500/45 bg-red-950/35 text-red-100 hover:border-red-400/60 hover:bg-red-950/55 sm:w-auto"
              >
                {clearSubmitting ? "Clearing..." : "Clear Attendance Data"}
              </button>
            </div>
          </section>

          <section className="table-shell">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700/50 text-sm">
                <thead className="bg-slate-900/70 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-4 font-medium">Trainee</th>
                    <th className="px-4 py-4 font-medium">Session day</th>
                    <th className="px-4 py-4 font-medium">Date</th>
                    <th className="px-4 py-4 font-medium">Time</th>
                    <th className="px-4 py-4 font-medium">Coach</th>
                    <th className="px-4 py-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/40">
                  {traineeLoading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <tr key={index} className="animate-pulse">
                        <td className="px-5 py-4" colSpan={6}>
                          <div className="h-4 rounded bg-slate-800" />
                        </td>
                      </tr>
                    ))
                  ) : traineeRecords.length ? (
                    traineeRecords.map((record) => (
                      <tr
                        key={record._id}
                        className="table-row-hover odd:bg-slate-900/15 even:bg-transparent"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-cyan-500/25 bg-slate-900">
                              {record.traineeId?.image ? (
                                <img
                                  src={record.traineeId.image}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[11px] font-bold text-cyan-400/45">
                                  {(record.traineeId?.name || "?")
                                    .charAt(0)
                                    .toUpperCase()}
                                </div>
                              )}
                            </div>
                            <span className="text-slate-200">
                              {record.traineeId?.name ?? "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-300">
                          {record.dayName ?? "—"}
                        </td>
                        <td className="px-5 py-4 text-slate-200">
                          {formatDateOnly(record.date)}
                        </td>
                        <td className="px-5 py-4 text-slate-200">
                          {formatTo12Hour(record.startTime)} –{" "}
                          {formatTo12Hour(record.endTime)}{" "}
                        </td>
                        <td className="px-5 py-4 text-slate-200">
                          {record.coachId?.name ?? "—"}
                        </td>
                        <td className="px-5 py-4">
                          {record.attended === false ? (
                            <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-3 py-1 text-xs font-medium text-red-200">
                              Absent
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                              Present
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="px-5 py-12 text-center text-slate-500"
                        colSpan={6}
                      >
                        {traineeEmptyHint}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <CoachesPagination
            currentPage={traineePage}
            totalPages={traineeTotalPages}
            totalItems={traineeTotalItems}
            limit={traineeLimit}
            loading={traineeLoading}
            onPrev={() => setTraineePage((current) => Math.max(1, current - 1))}
            onNext={() =>
              setTraineePage((current) =>
                Math.min(traineeTotalPages, current + 1)
              )
            }
          />
        </>
      )}

      <ConfirmModal
        open={clearOpen}
        title={
          attendanceTab === "coach"
            ? "Clear coach attendance data"
            : "Clear trainee attendance data"
        }
        message={
          attendanceTab === "coach"
            ? "This will permanently delete ONLY coach attendance records and reset coach working hours."
            : "This will permanently delete ONLY trainee attendance records."
        }
        confirmLabel={
          attendanceTab === "coach"
            ? "Clear coach attendance"
            : "Clear trainee attendance"
        }
        onConfirm={confirmClearAttendance}
        onCancel={() => {
          if (clearSubmitting) return;
          setClearOpen(false);
        }}
        loading={clearSubmitting}
      />

      <ConfirmModal
        open={detailsOpen}
        title="Absence details"
        message={
          <span
            dir={detailsNoteIsArabic ? "rtl" : "ltr"}
            className={`block whitespace-pre-wrap break-words leading-relaxed ${
              detailsNoteIsArabic ? "text-right" : "text-left"
            }`}
          >
            {detailsNote}
          </span>
        }
        confirmLabel="Close"
        onConfirm={() => setDetailsOpen(false)}
        onCancel={() => setDetailsOpen(false)}
        loading={false}
        danger={false}
        hideConfirm
      />
    </div>
  );
}
