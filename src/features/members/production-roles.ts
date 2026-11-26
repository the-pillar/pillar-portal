// The map lives in src/lib so every slice (the email slice included) shares
// it; the members slice keeps this path for its own importers.
export { PRODUCTION_ROLE_LABELS } from "@/lib/production-roles"
export type { ProductionRole } from "@/lib/production-roles"
