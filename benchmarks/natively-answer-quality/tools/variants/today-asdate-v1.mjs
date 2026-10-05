// I17 replay: keep the "# Today" section but ask for dates as written, never as a day relative to now.
export function transform({ system, user }) {
  return { system, user: user.replace(/(# Today\nIt is [^\n]*?)(Read validity dates, deadlines, ages and which version is current against it\.)/g,
    '$1$2 When you mention a date or deadline, say the date itself as the material writes it.') };
}
