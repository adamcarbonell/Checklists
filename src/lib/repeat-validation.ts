import { and, eq, isNull } from "drizzle-orm";
import {
  getDatabase,
  type Database,
  type DatabaseTransaction,
} from "@/db/client";
import { variableDefinitions } from "@/db/schema";
import { InputError } from "./input";
export async function validateRepeatVariable(
  id?: string | null,
  db: Database | DatabaseTransaction = getDatabase(),
) {
  if (!id) return;
  const [row] = await db
    .select({ id: variableDefinitions.id })
    .from(variableDefinitions)
    .where(
      and(
        eq(variableDefinitions.id, id),
        eq(variableDefinitions.cardinality, "list"),
        eq(variableDefinitions.enabled, true),
        isNull(variableDefinitions.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new InputError("repeat_variable_must_be_active_list");
}
