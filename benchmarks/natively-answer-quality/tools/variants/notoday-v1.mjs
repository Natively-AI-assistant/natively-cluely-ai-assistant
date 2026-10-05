// I17 replay: the prompt WITHOUT the "# Today" section (fix6 prompts carry it when the material mentions a date).
export function transform({ system, user }) {
  return { system, user: user.replace(/\n*# Today\nIt is [^\n]*\n?/g, '\n\n').replace(/\n{3,}/g, '\n\n') };
}
