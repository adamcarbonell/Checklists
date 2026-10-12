export const TEMPLATE_RESET_MARKER = "CHECKLIST_TEMPLATE_RESET";
export class MigrationConfirmationError extends Error {}
export function requireMigrationConfirmation(
  statements: string[],
  args: string[],
) {
  if (
    statements.some((statement) => statement.includes(TEMPLATE_RESET_MARKER)) &&
    !args.includes("--confirm-template-reset")
  ) {
    throw new MigrationConfirmationError(
      "Template redesign reset is pending. Reconfirm the test-data reset, pause web writes, then run migrations with --confirm-template-reset.",
    );
  }
}
