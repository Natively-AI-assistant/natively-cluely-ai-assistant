// E28 base arm: the recorded prompt, with the per-row session id in the evidence tags made constant.
// The benchmark asks every question in a new session, so `scope_id` differs from row to row; inside one real meeting
// it does not. Making it constant is what lets a replay see what the provider's prefix cache would do in a meeting.
export const oneMeeting = (user) => user.replace(/session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'session_00000000-0000-4000-8000-000000000000');
export function transform({ system, user }) { return { system, user: oneMeeting(user) }; }
