import { Activity, Building2, Lightbulb, ShieldAlert, Zap, type LucideIcon } from "lucide-react";
import type { NodeKind } from "../../lib/strategies";

export const kindIcon: Record<NodeKind, LucideIcon> = {
  company: Building2,
  event: Zap,
  assumption: Lightbulb,
  reaction: Activity,
  risk: ShieldAlert,
};
