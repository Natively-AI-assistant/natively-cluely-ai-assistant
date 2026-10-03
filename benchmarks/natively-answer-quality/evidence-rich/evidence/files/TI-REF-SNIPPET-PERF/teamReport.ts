// Weekly workload report for a team: one row per active member with their
// open and overdue tasks and the time they last signed in.

export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Member {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "member";
}

export interface MemberRow {
  memberId: string;
  displayName: string;
  role: Member["role"];
  openTasks: number;
  overdueTasks: number;
  lastLoginAt: Date | null;
}

export interface TeamReport {
  teamId: string;
  generatedAt: Date;
  rows: MemberRow[];
  totals: { members: number; openTasks: number; overdueTasks: number };
}

const REPORT_TTL_MS = 60_000;
const cache = new Map<string, { expires: number; report: TeamReport }>();

const MEMBERS_SQL = `
  SELECT id, display_name AS "displayName", role
    FROM members
   WHERE team_id = $1 AND deactivated_at IS NULL
   ORDER BY display_name`;

const TASK_COUNTS_SQL = `
  SELECT count(*) FILTER (WHERE status = 'open')                 AS open,
         count(*) FILTER (WHERE status = 'open' AND due_at < $2) AS overdue
    FROM tasks
   WHERE assignee_id = $1`;

const LAST_LOGIN_SQL = `
  SELECT max(created_at) AS "lastLoginAt"
    FROM login_events
   WHERE member_id = $1`;

export async function buildTeamReport(
  db: Queryable,
  teamId: string,
  now: Date = new Date(),
): Promise<TeamReport> {
  const cached = cache.get(teamId);
  if (cached && cached.expires > now.getTime()) {
    return cached.report;
  }

  const members = await db.query<Member>(MEMBERS_SQL, [teamId]);

  const rows: MemberRow[] = [];
  for (const member of members.rows) {
    const tasks = await db.query<{ open: string; overdue: string }>(TASK_COUNTS_SQL, [member.id, now]);
    const login = await db.query<{ lastLoginAt: Date | null }>(LAST_LOGIN_SQL, [member.id]);
    rows.push({
      memberId: member.id,
      displayName: member.displayName,
      role: member.role,
      openTasks: Number(tasks.rows[0]?.open ?? 0),
      overdueTasks: Number(tasks.rows[0]?.overdue ?? 0),
      lastLoginAt: login.rows[0]?.lastLoginAt ?? null,
    });
  }

  const report: TeamReport = {
    teamId,
    generatedAt: now,
    rows,
    totals: {
      members: rows.length,
      openTasks: rows.reduce((sum, row) => sum + row.openTasks, 0),
      overdueTasks: rows.reduce((sum, row) => sum + row.overdueTasks, 0),
    },
  };

  cache.set(teamId, { expires: now.getTime() + REPORT_TTL_MS, report });
  return report;
}

export function invalidateTeamReport(teamId: string): void {
  cache.delete(teamId);
}

export function overdueShare(report: TeamReport): number {
  if (report.totals.openTasks === 0) {
    return 0;
  }
  return report.totals.overdueTasks / report.totals.openTasks;
}

export function busiestMembers(report: TeamReport, limit = 5): MemberRow[] {
  return [...report.rows]
    .sort((a, b) => b.openTasks - a.openTasks || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}
