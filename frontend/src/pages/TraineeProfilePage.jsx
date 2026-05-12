import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../services/api.js";

function getErrorMessage(err) {
  const msg = err?.response?.data?.message;
  if (typeof msg === "string") return msg;
  return "Something went wrong";
}

// 🔥 Smart RTL / LTR Component
function SmartText({ text, className = "" }) {
  const isArabic = /[\u0600-\u06FF]/.test(text || "");
  return (
    <p
      dir={isArabic ? "rtl" : "ltr"}
      className={`${className} ${isArabic ? "text-right" : "text-left"}`}
    >
      {text || "—"}
    </p>
  );
}

function formatDateOnly(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const [y, m, day] = raw.split("-");
  return `${day}/${m}/${y}`;
}

function sessionSummary(trainee) {
  const session = trainee?.sessionId;

  if (!session || typeof session !== "object") {
    return "Not assigned to a group session yet";
  }

  const schedule = Array.isArray(session.schedule) ? session.schedule : [];

  if (!schedule.length) {
    return "Assigned to a session";
  }

  return schedule
    .map((slot) => `${slot.day} ${slot.startTime} - ${slot.endTime}`)
    .join(", ");
}

export default function TraineeProfilePage() {
  const { id } = useParams();

  const [trainee, setTrainee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const { data } = await api.get(`/api/trainees/${id}`);
        if (!cancelled) setTrainee(data);
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

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-36 rounded bg-slate-800" />
        <div className="h-56 rounded-2xl bg-slate-800/80" />
      </div>
    );
  }

  if (error || !trainee) {
    return (
      <div className="space-y-6">
        <Link to="/trainees" className="link-back">
          ← Back to trainees
        </Link>

        <div className="error-box">{error || "Trainee not found."}</div>
      </div>
    );
  }

  const imageUrl = trainee.image || null;
  const firstLetter = trainee.name?.charAt(0)?.toUpperCase() || "?";
  const notesText = trainee.notes?.trim() ? trainee.notes : "No notes added";
  const stats = trainee.attendanceStats ?? null;
  const history = Array.isArray(trainee.attendanceHistory) ? trainee.attendanceHistory : [];

  return (
    <div className="animate-fade-in space-y-4 md:space-y-5">
      <Link to="/trainees" className="link-back">
        ← Back to trainees
      </Link>

      <div className="card-float overflow-hidden p-0">
        {/* HEADER */}
        <div className="border-b border-cyan-500/10 bg-gradient-to-r from-cyan-500/10 via-transparent to-sky-500/10 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
            SWIMAX · Trainee
          </p>

          <SmartText
            text={trainee.name}
            className="mt-2 text-2xl font-semibold text-white md:text-3xl"
          />
        </div>

        {/* CONTENT */}
        <div className="flex flex-col gap-4 p-5 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
          
          {/* IMAGE */}
          <div className="mx-auto w-full md:mx-0 md:self-start">
            <div className="relative h-[240px] w-full overflow-hidden rounded-2xl border border-cyan-500/25 shadow-glow-sm ring-2 ring-cyan-400/10 md:h-[260px]">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-5xl font-bold text-cyan-400/40">
                  {firstLetter}
                </div>
              )}
            </div>
          </div>

          {/* DATA */}
          <div className="flex h-full flex-col gap-4">
            <div className="grid h-full gap-4 sm:grid-cols-2">

              {/* NAME */}
              <div className="profile-stat">
                <p className="text-xs text-slate-500">Name</p>
                <SmartText
                  text={trainee.name}
                  className="mt-2 text-lg text-white"
                />
              </div>

              {/* AGE */}
              <div className="profile-stat">
                <p className="text-xs text-slate-500">Age</p>
                <p className="mt-2 text-white">{trainee.age}</p>
              </div>

              {/* PHONE */}
              <div className="profile-stat">
                <p className="text-xs text-slate-500">Phone</p>
                <SmartText
                  text={trainee.phone}
                  className="mt-2 text-slate-300"
                />
              </div>

              {/* ADDRESS */}
              <div className="profile-stat">
                <p className="text-xs text-slate-500">Address</p>
                <SmartText
                  text={trainee.address}
                  className="mt-2 text-slate-300"
                />
              </div>

              {/* SKILL */}
              <div className="profile-stat border-sky-500/20 bg-gradient-to-br from-sky-500/5 to-transparent">
                <p className="text-xs text-slate-500">Skill level</p>
                <SmartText
                  text={trainee.level}
                  className="mt-2 text-xl font-bold text-cyan-300"
                />
              </div>

              {/* CREATED */}
              <div className="profile-stat">
                <p className="text-xs text-slate-500">Created</p>
                <p className="mt-2 text-slate-300">
                  {trainee.createdAt
                    ? new Date(trainee.createdAt).toLocaleString()
                    : "—"}
                </p>
              </div>

              {/* SESSION */}
              <div className="profile-stat sm:col-span-2">
                <p className="text-xs text-slate-500">Group session</p>
                <SmartText
                  text={sessionSummary(trainee)}
                  className="mt-2 text-slate-300"
                />
              </div>

              {/* NOTES */}
              <div className="profile-stat sm:col-span-2">
                <p className="text-xs text-slate-500">Notes</p>
                <SmartText
                  text={notesText}
                  className="mt-2 text-slate-300 whitespace-pre-wrap"
                />
              </div>

            </div>

            {stats ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div className="profile-stat border-emerald-500/15 bg-emerald-500/5">
                  <p className="text-xs text-slate-500">Sessions attended</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-200">
                    {stats.totalAttendedSessions ?? 0}
                  </p>
                </div>
                <div className="profile-stat border-red-500/15 bg-red-500/5">
                  <p className="text-xs text-slate-500">Absences recorded</p>
                  <p className="mt-2 text-2xl font-semibold text-red-200">
                    {stats.totalAbsentSessions ?? 0}
                  </p>
                </div>
                <div className="profile-stat border-sky-500/15 bg-sky-500/5">
                  <p className="text-xs text-slate-500">Attendance rate</p>
                  <p className="mt-2 text-2xl font-semibold text-sky-200">
                    {(stats.attendancePercentage ?? 0).toFixed(2)}%
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Based on {stats.totalRecordedSessions ?? 0} recorded session marks
                  </p>
                </div>
              </div>
            ) : null}

            {history.length ? (
              <div className="mt-4 rounded-2xl border border-slate-700/55 bg-slate-950/35 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
                  Attendance history
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-700/45 text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Day</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Coach</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/35">
                      {history.map((row) => {
                        const sid = row.sessionId;
                        const coachFromSession = sid?.coachId?.name;
                        const coachName = row.coachId?.name ?? coachFromSession ?? "—";
                        return (
                          <tr key={row._id} className="table-row-hover">
                            <td className="px-3 py-3 text-slate-200">{row.dayName ?? "—"}</td>
                            <td className="px-3 py-3 text-slate-200">{formatDateOnly(row.date)}</td>
                            <td className="px-3 py-3 text-slate-300">
                              {row.startTime} – {row.endTime}
                            </td>
                            <td className="px-3 py-3 text-slate-300">{coachName}</td>
                            <td className="px-3 py-3">
                              {row.attended === false ? (
                                <span className="inline-flex rounded-full border border-red-500/30 bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-200">
                                  Absent
                                </span>
                              ) : (
                                <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                                  Present
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : stats && stats.totalRecordedSessions === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-700/60 bg-slate-950/25 px-4 py-6 text-center text-sm text-slate-500">
                No attendance history recorded yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}