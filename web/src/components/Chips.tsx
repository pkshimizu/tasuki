/**
 * 役の印と、司令塔の指示と結果の印。
 */
import type { CSSProperties } from "react";
import type { Directive } from "../../../src/admin/types.js";
import type { Role } from "../../../src/config/config.js";
import { type Messages, targetLabel } from "../i18n.js";
import { Icon, ICONS, ROLE_ICONS } from "./Icon.js";

/** 役の色を、CSS の変数として渡す */
function roleColor(role: Role): CSSProperties {
  return { "--role": `var(--r-${role})` } as CSSProperties;
}

export function RoleChip({
  t,
  role,
  large = false,
}: {
  t: Messages;
  role: Role;
  large?: boolean;
}) {
  return (
    <span className={large ? "role lg" : "role"} style={roleColor(role)}>
      <Icon d={ROLE_ICONS[role]} size={large ? 14 : 13} stroke={2} />
      {t.roles[role]}
    </span>
  );
}

/** 指示の見出し（何をするか）と、色を付ける役 */
export function directiveLabel(
  t: Messages,
  d: Directive,
  requirementNames: ReadonlyMap<string, string>,
): { label: string; icon: string; role: Role | null } {
  switch (d.type) {
    case "run_agent":
      return d.role
        ? {
            label: t.directive.launch(
              t.roles[d.role],
              targetLabel(t, d.target, requirementNames),
            ),
            icon: ROLE_ICONS[d.role],
            role: d.role,
          }
        : { label: t.directive.launch("", ""), icon: ICONS.code, role: null };
    case "ask_human":
      return { label: t.directive.ask, icon: ICONS.question, role: null };
    case "notify":
      return { label: t.directive.notify, icon: ICONS.bell, role: null };
    case "merge_pr":
      return {
        label: t.directive.merge(
          d.number !== null ? t.target.pr(d.number) : "",
        ),
        icon: ICONS.merge,
        role: null,
      };
    case "complete_requirement":
      return { label: t.directive.complete, icon: ICONS.check, role: null };
    case "wait":
      return { label: t.directive.wait, icon: ICONS.clock, role: null };
  }
}

/** 指示の結果の文言 */
export function outcomeLabel(t: Messages, d: Directive): string {
  if (d.outcome === "skipped") return t.outcome.skipped;
  if (d.outcome === "failed") return t.outcome.failed;
  return t.outcome[d.type];
}

export function DirectiveChip({
  t,
  directive,
  requirementNames,
}: {
  t: Messages;
  directive: Directive;
  requirementNames: ReadonlyMap<string, string>;
}) {
  const { label, icon, role } = directiveLabel(t, directive, requirementNames);
  return (
    <span
      className="directive"
      title={directive.detail || undefined}
      style={role ? roleColor(role) : undefined}
    >
      <span className="what">
        <Icon d={icon} size={12} stroke={2} />
        {label}
      </span>
      <span className={`result ${directive.outcome}`}>
        {outcomeLabel(t, directive)}
      </span>
    </span>
  );
}
