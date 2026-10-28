import { NAV_SECTIONS, type NavSection } from '@emden/shared';

/** Bereiche, die eine Person sehen darf: alle ohne Berechtigung, die anderen nur mit passender Berechtigung. */
export function visibleSections(permissions: readonly string[]): NavSection[] {
  const sections: readonly NavSection[] = NAV_SECTIONS;
  return sections.filter((section) => !section.permission || permissions.includes(section.permission));
}
