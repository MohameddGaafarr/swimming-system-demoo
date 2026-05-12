import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api.js";
import SessionTable from "../components/SessionTable.jsx";
import SessionForm from "../components/SessionForm.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import SessionsToolbar from "../components/SessionsToolbar.jsx";
import CoachesPagination from "../components/CoachesPagination.jsx";
import FullscreenModal from "../components/FullscreenModal.jsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import {
  getCairoDateOnly,
  getSessionLiveBadgeFromContext,
} from "../utils/sessionActivity.js";
import {
  buildOccurrenceKey,
  buildTraineeOccurrenceKey,
} from "../utils/occurrenceKey.js";
import { parseTimeToMinutes } from "../utils/localDateTime.js";

function getErrorMessage(err) {
  const msg = err?.response?.data?.message;
  if (typeof msg === "string") return msg;
  return "Something went wrong";
}

function formatSessionLabel(sessionId) {
  if (!sessionId || typeof sessionId !== "object")
    return "Assigned to another session";
  const schedule = Array.isArray(sessionId.schedule) ? sessionId.schedule : [];
  if (!schedule.length) return "Assigned to another session";
  const firstSlot = schedule[0];
  const shortDay = String(firstSlot.day ?? "").slice(0, 3);
  return `${shortDay} ${firstSlot.startTime}-${firstSlot.endTime}`;
}

function formatTo12Hour(time) {
  if (!time) return "";

  const [hours, minutes] = String(time).split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return time;
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export default function SessionsPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [sortBy, setSortBy] = useState("createdAt");
  const [order, setOrder] = useState("desc");

  const [sessions, setSessions] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState("create");
  const [editingSession, setEditingSession] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [coaches, setCoaches] = useState([]);
  const [trainees, setTrainees] = useState([]);
  const [referenceLoading, setReferenceLoading] = useState(false);

  const [clearOpen, setClearOpen] = useState(false);
  const [clearSubmitting, setClearSubmitting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingSession, setDeletingSession] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [activeSessions, setActiveSessions] = useState([]);
  const [activityPoolSessions, setActivityPoolSessions] = useState([]);
  const [attendanceStatusByKey, setAttendanceStatusByKey] = useState({});
  const [traineeAttendanceStatusByKey, setTraineeAttendanceStatusByKey] =
    useState({});
  const [reasonOpenByKey, setReasonOpenByKey] = useState({});
  const [reasonDraftByKey, setReasonDraftByKey] = useState({});
  const [attendanceSubmittingByKey, setAttendanceSubmittingByKey] = useState(
    {}
  );
  const [
    traineeAttendanceSubmittingByKey,
    setTraineeAttendanceSubmittingByKey,
  ] = useState({});
  const [activeNowContext, setActiveNowContext] = useState(null);

  const currentSessionId = editingSession?._id ?? null;

  // ================= LOAD =================
  const loadReferenceData = useCallback(async () => {
    setReferenceLoading(true);
    try {
      const [coachesRes, traineesRes] = await Promise.all([
        api.get("/api/coaches"),
        api.get("/api/trainees"),
      ]);
      setCoaches(coachesRes.data?.coaches || []);
      setTrainees(traineesRes.data?.trainees || []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReferenceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (formOpen) loadReferenceData();
  }, [formOpen, loadReferenceData]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/sessions", {
        params: { search: debouncedSearch, page, limit, sortBy, order },
      });

      setSessions(data.sessions || []);
      setTotalItems(data.totalItems || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, limit, sortBy, order]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadCurrentSessions = useCallback(async () => {
    try {
      const { data } = await api.get("/api/sessions/current");
      setActiveSessions(Array.isArray(data?.current) ? data.current : []);
      setActiveNowContext(
        data?.now
          ? {
              day: data.now.weekday,
              minutesOfDay: data.now.minutesOfDay,
              dateOnly: data.now.dateOnly,
              timestampMs: data.now.timestampMs,
            }
          : null
      );
    } catch {
      setActiveSessions([]);
      setActiveNowContext(null);
    }
  }, []);

  const loadActivityPoolSessions = useCallback(async () => {
    try {
      const { data } = await api.get("/api/sessions", {
        params: { page: 1, limit: 500, sortBy: "createdAt", order: "desc" },
      });
      setActivityPoolSessions(
        Array.isArray(data?.sessions) ? data.sessions : []
      );
    } catch {
      setActivityPoolSessions([]);
    }
  }, []);

  const loadTodayAttendanceState = useCallback(async () => {
    try {
      const today = getCairoDateOnly();
      const [coachRes, traineeRes] = await Promise.all([
        api.get("/api/attendance", { params: { date: today } }),
        api.get("/api/attendance/trainees", { params: { date: today } }),
      ]);
      const coachMap =
        coachRes.data?.statusByKey &&
        typeof coachRes.data.statusByKey === "object"
          ? coachRes.data.statusByKey
          : {};
      const traineeMap =
        traineeRes.data?.statusByKey &&
        typeof traineeRes.data.statusByKey === "object"
          ? traineeRes.data.statusByKey
          : {};
      setAttendanceStatusByKey(coachMap);
      setTraineeAttendanceStatusByKey(traineeMap);
    } catch {
      setAttendanceStatusByKey({});
      setTraineeAttendanceStatusByKey({});
    }
  }, []);

  useEffect(() => {
    loadCurrentSessions();
    loadActivityPoolSessions();
    loadTodayAttendanceState();
  }, [loadCurrentSessions, loadActivityPoolSessions, loadTodayAttendanceState]);

  useEffect(() => {
    const timerId = setInterval(() => {
      loadCurrentSessions();
    }, 60000);
    const onFocus = () => {
      if (document.visibilityState && document.visibilityState !== "visible")
        return;
      loadCurrentSessions();
      loadTodayAttendanceState();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timerId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadCurrentSessions, loadTodayAttendanceState]);

  // ================= ACTIONS =================
  function openCreate() {
    setFormMode("create");
    setEditingSession(null);
    setFormOpen(true);
  }

  function openEdit(session) {
    setFormMode("edit");
    setEditingSession(session);
    setFormOpen(true);
  }

  function closeForm() {
    if (formSubmitting) return;
    setFormOpen(false);
    setEditingSession(null);
  }

  async function handleFormSubmit(payload) {
    setFormSubmitting(true);
    try {
      if (formMode === "create") {
        const { data } = await api.post("/api/sessions", payload);
        setSessions((prev) => [data, ...prev].slice(0, limit));
        setTotalItems((prev) => prev + 1);
      } else {
        const { data } = await api.put(
          `/api/sessions/${editingSession._id}`,
          payload
        );
        setSessions((prev) =>
          prev.map((item) => (item._id === data._id ? data : item))
        );
      }
      await loadCurrentSessions();
      await loadActivityPoolSessions();
      closeForm();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setFormSubmitting(false);
    }
  }

  function openDelete(session) {
    setDeletingSession(session);
    setDeleteOpen(true);
  }

  function closeDelete() {
    if (deleteSubmitting) return;
    setDeleteOpen(false);
    setDeletingSession(null);
  }

  async function confirmDelete() {
    setDeleteSubmitting(true);
    try {
      await api.delete(`/api/sessions/${deletingSession._id}`);
      setSessions((prev) =>
        prev.filter((item) => item._id !== deletingSession._id)
      );
      setActivityPoolSessions((prev) =>
        prev.filter((item) => item._id !== deletingSession._id)
      );
      setTotalItems((prev) => Math.max(0, prev - 1));
      await loadCurrentSessions();
      closeDelete();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function confirmClearAllSessions() {
    setClearSubmitting(true);
    try {
      await api.delete("/api/sessions/clear");
      setSessions([]);
      setActiveSessions([]);
      setActivityPoolSessions([]);
      setTotalItems(0);
      setTotalPages(1);
      setClearOpen(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setClearSubmitting(false);
    }
  }

  async function submitAttendance(sessionLike, attendedValue) {
    if (!sessionLike?._id || !sessionLike?.currentSlot) return;
    const occurrenceKey = buildOccurrenceKey(
      sessionLike._id,
      getCairoDateOnly(),
      sessionLike.currentSlot.startTime
    );
    setAttendanceSubmittingByKey((prev) => ({
      ...prev,
      [occurrenceKey]: true,
    }));
    setError(null);
    try {
      const reasonValue = String(reasonDraftByKey[occurrenceKey] ?? "").trim();
      await api.post("/api/attendance", {
        sessionId: sessionLike._id,
        date: getCairoDateOnly(),
        startTime: sessionLike.currentSlot.startTime,
        endTime: sessionLike.currentSlot.endTime,
        attended: attendedValue,
        reason: attendedValue ? "" : reasonValue,
      });
      setAttendanceStatusByKey((prev) => ({
        ...prev,
        [occurrenceKey]: {
          attended: attendedValue,
          reason: attendedValue ? "" : reasonValue,
        },
      }));
      setReasonOpenByKey((prev) => ({ ...prev, [occurrenceKey]: false }));
      setReasonDraftByKey((prev) => ({ ...prev, [occurrenceKey]: "" }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAttendanceSubmittingByKey((prev) => ({
        ...prev,
        [occurrenceKey]: false,
      }));
    }
  }

  async function submitTraineeAttendance(
    traineeId,
    sessionLike,
    attendedValue
  ) {
    if (!sessionLike?._id || !sessionLike?.currentSlot || !traineeId) return;
    const tKey = buildTraineeOccurrenceKey(
      traineeId,
      sessionLike._id,
      getCairoDateOnly(),
      sessionLike.currentSlot.startTime
    );
    setTraineeAttendanceSubmittingByKey((prev) => ({ ...prev, [tKey]: true }));
    setError(null);
    try {
      await api.post("/api/attendance/trainees", {
        sessionId: sessionLike._id,
        traineeId,
        date: getCairoDateOnly(),
        startTime: sessionLike.currentSlot.startTime,
        endTime: sessionLike.currentSlot.endTime,
        attended: attendedValue,
        reason: "",
      });
      setTraineeAttendanceStatusByKey((prev) => ({
        ...prev,
        [tKey]: { attended: attendedValue, reason: "" },
      }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setTraineeAttendanceSubmittingByKey((prev) => ({
        ...prev,
        [tKey]: false,
      }));
    }
  }

  const traineeOptions = useMemo(() => {
    return trainees.map((t) => {
      const assigned = t.sessionId?._id || t.sessionId;
      return {
        _id: t._id,
        name: t.name,
        unavailable: assigned && assigned !== currentSessionId,
        sessionLabel: assigned ? formatSessionLabel(t.sessionId) : "",
      };
    });
  }, [trainees, currentSessionId]);

  function getNextDay(day) {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const idx = days.indexOf(String(day ?? ""));
    if (idx < 0) return null;
    return days[(idx + 1) % 7];
  }

  const visibleActiveSessions = useMemo(() => {
    const nowCtx = activeNowContext;
    const dateOnly = nowCtx?.dateOnly || getCairoDateOnly();
    const nowDay = String(nowCtx?.day ?? "");
    const nowMinutes = Number(nowCtx?.minutesOfDay);
    const currentByKey = new Map();

    for (const currentSession of activeSessions) {
      const key = buildOccurrenceKey(
        currentSession._id,
        dateOnly,
        currentSession.currentSlot?.startTime
      );
      currentByKey.set(key, currentSession);
    }

    if (!nowDay || !Number.isFinite(nowMinutes)) {
      return Array.from(currentByKey.values());
    }

    const pending = [];
    for (const session of activityPoolSessions) {
      const slots = Array.isArray(session?.schedule) ? session.schedule : [];
      for (const slot of slots) {
        const start = parseTimeToMinutes(slot?.startTime);
        const end = parseTimeToMinutes(slot?.endTime);
        if (start === null || end === null || start === end) continue;

        let hasStarted = false;
        if (end > start) {
          hasStarted =
            String(slot?.day ?? "") === nowDay && nowMinutes >= start;
        } else {
          const nextDay = getNextDay(slot?.day);
          hasStarted =
            (String(slot?.day ?? "") === nowDay && nowMinutes >= start) ||
            nextDay === nowDay;
        }
        if (!hasStarted) continue;

        const key = buildOccurrenceKey(session._id, dateOnly, slot?.startTime);

        const coachMarked = Boolean(attendanceStatusByKey[key]);

        const traineesList = Array.isArray(session?.trainees)
          ? session.trainees
          : [];

        const allTraineesMarked =
          traineesList.length > 0 &&
          traineesList.every((trainee) => {
            const traineeId = trainee?._id ?? trainee;

            const traineeKey = buildTraineeOccurrenceKey(
              traineeId,
              session._id,
              dateOnly,
              slot?.startTime
            );

            return Boolean(traineeAttendanceStatusByKey[traineeKey]);
          });

        const shouldHide = coachMarked && allTraineesMarked;

        if (shouldHide || currentByKey.has(key)) continue;

        pending.push({
          ...session,
          currentSlot: slot,
        });
      }
    }

    return [...Array.from(currentByKey.values()), ...pending];
  }, [
    activeSessions,
    activityPoolSessions,
    activeNowContext,
    attendanceStatusByKey,
    traineeAttendanceStatusByKey,
  ]);

  // ================= UI =================
  return (
    <div className="animate-fade-in space-y-4 md:space-y-5">
      {error && <div className="error-box">{error}</div>}

      <div className="card-float p-3 md:p-4">
        <SessionsToolbar
          search={search}
          onSearchChange={setSearch}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          order={order}
          onOrderChange={setOrder}
          limit={limit}
          onLimitChange={setLimit}
          actions={
            <>
              <button
                onClick={() => setClearOpen(true)}
                className="btn-secondary"
              >
                Clear All Sessions
              </button>
              <button onClick={openCreate} className="btn-primary">
                Add session
              </button>
            </>
          }
        />
      </div>

      <SessionTable
        sessions={sessions}
        loading={loading}
        onEdit={openEdit}
        onDelete={openDelete}
      />

      <CoachesPagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalItems}
        limit={limit}
        loading={loading}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      />

      {visibleActiveSessions.length ? (
        <section className="card-float p-3 md:p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">
            Active session now
          </h2>
          <div className="space-y-3">
            {visibleActiveSessions.map((sessionLike) => {
              const occurrenceKey = buildOccurrenceKey(
                sessionLike._id,
                getCairoDateOnly(),
                sessionLike.currentSlot?.startTime
              );
              const attendanceRecord = attendanceStatusByKey[occurrenceKey];
              const attendanceStatus =
                attendanceRecord?.attended === false
                  ? "not_attended"
                  : attendanceRecord?.attended === true
                  ? "attended"
                  : null;
              const isSubmitting = Boolean(
                attendanceSubmittingByKey[occurrenceKey]
              );
              const reasonOpen = Boolean(reasonOpenByKey[occurrenceKey]);
              const reasonDraft = String(reasonDraftByKey[occurrenceKey] ?? "");

              return (
                <article
                  key={occurrenceKey}
                  className="rounded-2xl border border-slate-700/60 bg-slate-950/35 p-3"
                >
                  <div className="grid gap-2 text-xs sm:grid-cols-2 sm:text-sm lg:flex lg:flex-wrap lg:items-center lg:gap-5">
                    <p className="text-slate-300">
                      <span className="text-slate-500">Slot · </span>
                      {`${sessionLike.currentSlot.day} ${formatTo12Hour(
                        sessionLike.currentSlot.startTime
                      )} - ${formatTo12Hour(sessionLike.currentSlot.endTime)}`}
                    </p>
                    <p className="text-slate-300">
                      {(() => {
                        const badgeText =
                          getSessionLiveBadgeFromContext(
                            sessionLike.currentSlot,
                            activeNowContext
                          ) || "Now";

                        const isEnded = badgeText.startsWith("Ended");

                        return (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                              isEnded
                                ? "border-red-500/35 bg-red-500/15 text-red-200"
                                : "border-sky-400/35 bg-sky-500/15 text-sky-200"
                            }`}
                          >
                            {badgeText}
                          </span>
                        );
                      })()}
                    </p>
                    <p className="text-slate-300">
                      <span className="text-slate-500">Coach · </span>
                      {sessionLike.coachId?.name || "—"}
                    </p>
                    <p className="text-slate-300">
                      <span className="text-slate-500">No. of trainees · </span>
                      {Array.isArray(sessionLike.trainees)
                        ? sessionLike.trainees.length
                        : 0}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-col items-stretch gap-2 text-right sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    {attendanceStatus === "attended" ? (
                      <span className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                        Marked as attended
                      </span>
                    ) : attendanceStatus === "not_attended" ? (
                      <span className="rounded-full border border-red-500/35 bg-red-500/15 px-3 py-1 text-xs font-medium text-red-200">
                        Marked as not attended
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => submitAttendance(sessionLike, true)}
                      disabled={isSubmitting || Boolean(attendanceStatus)}
                      className="btn-primary-sm w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {isSubmitting ? "Saving..." : "Attended"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setReasonOpenByKey((prev) => ({
                          ...prev,
                          [occurrenceKey]: !reasonOpen,
                        }))
                      }
                      disabled={isSubmitting || Boolean(attendanceStatus)}
                      className="w-full rounded-xl border border-red-500/40 bg-red-950/25 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-950/45 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      Not Attended
                    </button>
                  </div>

                  {reasonOpen && !attendanceStatus ? (
                    <div className="mt-3 rounded-2xl border border-slate-700/60 bg-slate-950/40 p-3">
                      <textarea
                        rows={2}
                        value={reasonDraft}
                        onChange={(e) =>
                          setReasonDraftByKey((prev) => ({
                            ...prev,
                            [occurrenceKey]: e.target.value,
                          }))
                        }
                        placeholder="Enter absence reason..."
                        className="w-full resize-none rounded-xl border border-slate-700/70 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-red-400/50 focus:ring-2 focus:ring-red-500/25"
                      />
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            if (isSubmitting) return;
                            setReasonOpenByKey((prev) => ({
                              ...prev,
                              [occurrenceKey]: false,
                            }));
                            setReasonDraftByKey((prev) => ({
                              ...prev,
                              [occurrenceKey]: "",
                            }));
                          }}
                          disabled={isSubmitting}
                          className="btn-secondary w-full px-3 py-2 text-xs disabled:opacity-60 sm:w-auto"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => submitAttendance(sessionLike, false)}
                          disabled={isSubmitting || !reasonDraft.trim()}
                          className="w-full rounded-xl border border-red-500/40 bg-red-600/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        >
                          {isSubmitting ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(sessionLike.trainees) &&
                  sessionLike.trainees.length ? (
                    <div className="mt-4 border-t border-slate-700/50 pt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300/85">
                        Trainee attendance
                      </p>
                      <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                        {sessionLike.trainees.map((trainee) => {
                          const tid = trainee?._id ?? trainee;
                          const tKey = buildTraineeOccurrenceKey(
                            tid,
                            sessionLike._id,
                            getCairoDateOnly(),
                            sessionLike.currentSlot?.startTime
                          );
                          const tRecord = traineeAttendanceStatusByKey[tKey];
                          const tStatus =
                            tRecord?.attended === false
                              ? "absent"
                              : tRecord?.attended === true
                              ? "present"
                              : null;
                          const tSubmitting = Boolean(
                            traineeAttendanceSubmittingByKey[tKey]
                          );

                          return (
                            <div
                              key={String(tid)}
                              className="flex flex-col gap-4 rounded-xl border border-slate-700/55 bg-slate-950/45 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-cyan-500/25 bg-slate-900">
                                  {" "}
                                  {trainee?.image ? (
                                    <img
                                      src={trainee.image}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-sm font-bold text-cyan-400/50">
                                      {(trainee?.name || "?")
                                        .charAt(0)
                                        .toUpperCase()}
                                    </div>
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className="text-base font-semibold text-white break-words leading-snug">
                                    {trainee?.name || "Trainee"}
                                  </p>

                                  <p className="text-sm text-slate-400 break-words leading-snug mt-1">
                                    {trainee?.level || ""}
                                  </p>
                                </div>
                              </div>

                              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                {tStatus === "present" ? (
                                  <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                                    Present
                                  </span>
                                ) : tStatus === "absent" ? (
                                  <span className="rounded-full border border-red-500/35 bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-200">
                                    Absent
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() =>
                                    submitTraineeAttendance(
                                      tid,
                                      sessionLike,
                                      true
                                    )
                                  }
                                  disabled={tSubmitting || Boolean(tStatus)}
                                  className="btn-primary-sm px-3 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {tSubmitting ? "..." : "Present"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    submitTraineeAttendance(
                                      tid,
                                      sessionLike,
                                      false
                                    )
                                  }
                                  disabled={tSubmitting || Boolean(tStatus)}
                                  className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-1.5 text-[11px] font-semibold text-red-100 transition hover:bg-red-950/45 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {tSubmitting ? "..." : "Absent"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* FORM */}
      <FullscreenModal
        open={formOpen}
        onClose={closeForm}
        closeDisabled={formSubmitting}
        title={formMode === "create" ? "Create session" : "Edit session"}
      >
        <SessionForm
          initialValues={
            editingSession
              ? {
                  coachId:
                    editingSession.coachId?._id || editingSession.coachId,
                  traineeIds:
                    editingSession.trainees?.map((t) => t._id || t) || [],
                  schedule: editingSession.schedule || [],
                }
              : {
                  coachId: "",
                  traineeIds: [],
                  schedule: [{ day: "Sunday", startTime: "", endTime: "" }],
                }
          }
          coaches={coaches}
          trainees={traineeOptions}
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          submitting={formSubmitting}
        />
      </FullscreenModal>

      <ConfirmModal
        open={deleteOpen}
        title="Delete session"
        message="This will permanently delete this session."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={closeDelete}
        loading={deleteSubmitting}
      />

      <ConfirmModal
        open={clearOpen}
        title="Clear all sessions"
        message="This will permanently delete ALL sessions and unassign trainees."
        confirmLabel="Delete all"
        onConfirm={confirmClearAllSessions}
        onCancel={() => {
          if (clearSubmitting) return;
          setClearOpen(false);
        }}
        loading={clearSubmitting}
      />
    </div>
  );
}
