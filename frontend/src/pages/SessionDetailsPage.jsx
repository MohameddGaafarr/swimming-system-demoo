import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../services/api.js";
import { formatDuration } from "../utils/formatDuration.js";
import { getCairoDateOnly } from "../utils/sessionActivity.js";
import { buildTraineeOccurrenceKey } from "../utils/occurrenceKey.js";

function getErrorMessage(err) {
  const msg = err?.response?.data?.message;
  if (typeof msg === "string") return msg;
  return "Something went wrong";
}

function coachName(session) {
  const coach = session?.coachId;
  if (coach && typeof coach === "object" && coach.name) return coach.name;
  return "—";
}

function durationFromTimeRange(startTime, endTime) {
  const [startH, startM] = String(startTime ?? "").split(":").map(Number);
  const [endH, endM] = String(endTime ?? "").split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "—";
  return formatDuration(end - start);
}

export default function SessionDetailsPage() {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDate, setSelectedDate] = useState("");
  const [slotIndex, setSlotIndex] = useState(0);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState(null);
  const [attSubmittingByKey, setAttSubmittingByKey] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data } = await api.get(`/api/sessions/${id}`);
        if (!cancelled) setSession(data);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (session && !selectedDate) {
      setSelectedDate(getCairoDateOnly());
    }
  }, [session, selectedDate]);

  const schedule = Array.isArray(session?.schedule) ? session.schedule : [];

  useEffect(() => {
    if (slotIndex >= schedule.length) {
      setSlotIndex(0);
    }
  }, [schedule.length, slotIndex]);

  const safeSlotIndex = schedule.length ? Math.min(Math.max(0, slotIndex), schedule.length - 1) : 0;
  const selectedSlot = schedule[safeSlotIndex] ?? null;

  const loadAttendanceForSlot = useCallback(async () => {
    if (!id || !selectedDate || !selectedSlot) return;
    setAttLoading(true);
    setAttError(null);
    try {
      const { data } = await api.get("/api/attendance/trainees/by-session", {
        params: {
          sessionId: id,
          date: selectedDate,
          startTime: selectedSlot.startTime,
        },
      });
      setAttendanceRecords(Array.isArray(data?.records) ? data.records : []);
    } catch (err) {
      setAttError(getErrorMessage(err));
      setAttendanceRecords([]);
    } finally {
      setAttLoading(false);
    }
  }, [id, selectedDate, selectedSlot]);

  useEffect(() => {
    loadAttendanceForSlot();
  }, [loadAttendanceForSlot]);

  async function submitTraineeAttendance(traineeId, attendedValue) {
    if (!id || !selectedDate || !selectedSlot || !traineeId) return;
    const key = buildTraineeOccurrenceKey(traineeId, id, selectedDate, selectedSlot.startTime);
    setAttSubmittingByKey((prev) => ({ ...prev, [key]: true }));
    setAttError(null);
    try {
      await api.post("/api/attendance/trainees", {
        sessionId: id,
        traineeId,
        date: selectedDate,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        attended: attendedValue,
        reason: "",
      });
      await loadAttendanceForSlot();
    } catch (err) {
      setAttError(getErrorMessage(err));
    } finally {
      setAttSubmittingByKey((prev) => ({ ...prev, [key]: false }));
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-40 rounded bg-slate-800" />
        <div className="h-48 rounded-2xl bg-slate-800/80" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-6">
        <Link to="/sessions" className="link-back">
          ← Back to sessions
        </Link>
        <div className="error-box">{error || "Session not found."}</div>
      </div>
    );
  }

  const trainees = Array.isArray(session.trainees) ? session.trainees : [];

  const recordByTraineeId = Object.fromEntries(
    attendanceRecords.map((row) => [String(row.traineeId?._id ?? row.traineeId), row]),
  );

  return (
    <div className="animate-fade-in space-y-4 md:space-y-5">
      <div>
        <Link to="/sessions" className="link-back">
          ← Back to sessions
        </Link>
      </div>

      <div className="card-float grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-400/90">Coach</p>
          <p className="mt-2 text-xl font-semibold text-white md:text-2xl">{coachName(session)}</p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Weekly slots</p>
          {schedule.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {schedule.map((slot, index) => (
                <div
                  key={`${slot.day}-${slot.startTime}-${slot.endTime}-${index}`}
                  className="rounded-2xl border border-slate-700/50 bg-slate-950/50 p-4 transition hover:border-sky-500/25"
                >
                  <p className="font-semibold text-sky-200">{slot.day}</p>
                  <p className="mt-2 text-sm text-slate-300">
                    {slot.startTime} – {slot.endTime}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Duration · {durationFromTimeRange(slot.startTime, slot.endTime)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-slate-400">No schedule defined.</p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Created</p>
          <p className="mt-2 text-slate-300">
            {session.createdAt ? new Date(session.createdAt).toLocaleString() : "—"}
          </p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Trainees</p>
          {trainees.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {trainees.map((trainee) => (
                <div
                  key={trainee._id}
                  className="rounded-2xl border border-slate-700/50 bg-slate-950/40 px-4 py-3.5 transition hover:border-cyan-500/20"
                >
                  <p className="font-medium text-white">{trainee.name}</p>
                  <p className="mt-1 text-sm text-cyan-200/80">{trainee.level}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-slate-400">No trainees assigned.</p>
          )}
        </div>
      </div>

      {schedule.length && trainees.length ? (
        <section className="card-float space-y-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
              Trainee attendance
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Pick the calendar date and weekly slot, then mark each trainee for that session occurrence.
            </p>
          </div>

          {attError ? <div className="error-box">{attError}</div> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-slate-400">Session date</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="input-field !mt-0"
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-slate-400">Weekly slot</span>
              <select
                value={safeSlotIndex}
                onChange={(e) => setSlotIndex(Number(e.target.value) || 0)}
                className="input-field-select !mt-0"
              >
                {schedule.map((slot, index) => (
                  <option key={`${slot.day}-${slot.startTime}-${index}`} value={index}>
                    {slot.day} · {slot.startTime} – {slot.endTime}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedSlot ? (
            <div className="rounded-2xl border border-slate-700/55 bg-slate-950/35 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-200">
                  <span className="text-slate-500">Selected slot · </span>
                  {selectedSlot.day} {selectedSlot.startTime} – {selectedSlot.endTime}
                </p>
                {attLoading ? (
                  <span className="text-xs text-slate-500">Refreshing marks…</span>
                ) : (
                  <span className="text-xs text-slate-500">Marks loaded for this date</span>
                )}
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {trainees.map((trainee) => {
                  const tid = trainee?._id ?? trainee;
                  const existing = recordByTraineeId[String(tid)];
                  const status =
                    existing?.attended === false ? "absent" : existing?.attended === true ? "present" : null;
                  const key = selectedSlot
                    ? buildTraineeOccurrenceKey(tid, id, selectedDate, selectedSlot.startTime)
                    : "";
                  const submitting = Boolean(attSubmittingByKey[key]);

                  return (
                    <div
                      key={String(tid)}
                      className="flex flex-col gap-3 rounded-xl border border-slate-700/50 bg-slate-950/45 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-cyan-500/25 bg-slate-900">
                          {trainee?.image ? (
                            <img src={trainee.image} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-cyan-400/45">
                              {(trainee?.name || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{trainee.name}</p>
                          <p className="truncate text-xs text-slate-500">{trainee.level}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {status === "present" ? (
                          <span className="rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                            Present
                          </span>
                        ) : status === "absent" ? (
                          <span className="rounded-full border border-red-500/35 bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-200">
                            Absent
                          </span>
                        ) : (
                          <span className="rounded-full border border-slate-600/40 bg-slate-900/40 px-2 py-0.5 text-[11px] text-slate-500">
                            Not marked
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => submitTraineeAttendance(tid, true)}
                          disabled={submitting || Boolean(status)}
                          className="btn-primary-sm px-3 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submitting ? "…" : "Present"}
                        </button>
                        <button
                          type="button"
                          onClick={() => submitTraineeAttendance(tid, false)}
                          disabled={submitting || Boolean(status)}
                          className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-1.5 text-[11px] font-semibold text-red-100 transition hover:bg-red-950/45 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submitting ? "…" : "Absent"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
