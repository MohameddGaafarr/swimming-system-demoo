import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../services/api.js";
import { getPublicApiOrigin } from "../utils/apiOrigin.js";
import { formatDuration, hoursToMinutes } from "../utils/formatDuration.js";

function getErrorMessage(err) {
  const msg = err?.response?.data?.message;
  if (typeof msg === "string") return msg;
  return "Something went wrong";
}

function formatDateOnly(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const [y, m, day] = raw.split("-");
  return `${day}/${m}/${y}`;
}

function formatTime12(time) {
  const raw = String(time ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return raw || "—";

  let hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";

  hours = hours % 12 || 12;

  return `${hours}:${minutes} ${suffix}`;
}

// 🔥 Smart text component (auto RTL / LTR)
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

export default function CoachProfilePage() {
  const { id } = useParams();

  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const { data } = await api.get(`/api/coaches/${id}`);
        if (!cancelled) setCoach(data);
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
        <div className="h-4 w-32 rounded bg-slate-800" />
        <div className="h-64 rounded-2xl bg-slate-800/80" />
      </div>
    );
  }

  if (error || !coach) {
    return (
      <div className="space-y-6">
        <Link to="/coaches" className="link-back">
          ← Back to coaches
        </Link>

        <div className="error-box">{error || "Coach not found."}</div>
      </div>
    );
  }

  const imageUrl = coach.image?.startsWith("http")
    ? coach.image
    : coach.image
    ? (() => {
        const origin = getPublicApiOrigin();
        const path = String(coach.image).replace(/^\/+/, "");
        if (origin) return `${origin}/${path}`;
        return `/${path}`;
      })()
    : null;

  const firstLetter = coach.name?.charAt(0)?.toUpperCase() || "?";

  const stats = coach.attendanceStats ?? null;
  const history = Array.isArray(coach.attendanceHistory)
    ? coach.attendanceHistory
    : [];

  return (
    <div className="animate-fade-in space-y-4 md:space-y-5">
      <Link to="/coaches" className="link-back">
        ← Back to coaches
      </Link>

      <div className="card-float overflow-hidden p-0">
        {/* Header */}
        <div className="border-b border-sky-500/10 bg-gradient-to-r from-sky-500/10 via-transparent to-cyan-500/10 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">
            SWIMAX · Coach
          </p>

          <SmartText
            text={coach.name}
            className="mt-2 text-2xl font-semibold text-white md:text-3xl"
          />
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 p-5 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
          {/* Image */}
          <div className="mx-auto w-full md:mx-0">
            <div className="relative h-[240px] w-full overflow-hidden rounded-2xl border border-sky-500/20 shadow-glow-sm md:h-[260px]">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" />

              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-6xl font-bold text-sky-400/50">
                  {firstLetter}
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex h-full flex-col gap-4">
            <div className="grid h-full gap-4 sm:grid-cols-2">
              {/* Name */}
              <div className="profile-stat">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Name
                </p>
                <SmartText
                  text={coach.name}
                  className="mt-2 text-lg font-medium text-white"
                />
              </div>

              {/* Age */}
              <div className="profile-stat">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Age
                </p>
                <p className="mt-2 text-lg font-medium text-white">
                  {coach.age}
                </p>
              </div>

              {/* Address */}
              <div className="profile-stat sm:col-span-2">
                {" "}
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Address
                </p>
                <SmartText
                  text={coach.address}
                  className="mt-2 text-slate-300"
                />
              </div>

              {/* Phone */}
              <div className="profile-stat sm:col-span-2">
                {" "}
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Phone
                </p>
                <SmartText text={coach.phone} className="mt-2 text-slate-300" />
              </div>

              {/* Bio */}
              <div className="profile-stat overflow-visible sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Bio
                </p>
                <SmartText
                  text={coach.bio}
                  className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-slate-300"
                />
              </div>

              {/* Hours */}
              <div className="profile-stat border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total pool hours
                </p>
                <p className="mt-2 bg-gradient-to-r from-sky-300 to-cyan-400 bg-clip-text text-2xl font-bold text-transparent">
                  {formatDuration(hoursToMinutes(coach.totalWorkingHours))}
                </p>
              </div>

              {/* Created */}
              <div className="profile-stat">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Record created
                </p>
                <p className="mt-2 text-slate-300">
                  {coach.createdAt
                    ? new Date(coach.createdAt).toLocaleString()
                    : "—"}
                </p>
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
                    Based on {stats.totalRecordedSessions ?? 0} recorded session
                    marks
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
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Duration</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-700/35">
                      {history.map((row) => (
                        <tr key={row._id} className="table-row-hover">
                          <td className="px-3 py-3 text-slate-200">
                            {formatDateOnly(row.date)}
                          </td>

                          <td className="px-3 py-3 text-slate-300">
                            {formatTime12(row.startTime)} –{" "}
                            {formatTime12(row.endTime)}{" "}
                          </td>

                          <td className="px-3 py-3 text-slate-300">
                            {formatDuration(
                              row.durationMinutes ??
                                hoursToMinutes(row.durationHours)
                            )}
                          </td>

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
                      ))}
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
