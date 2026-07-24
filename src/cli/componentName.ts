/**
 * Component instance name resolution shared by the deploy and upload commands.
 *
 * 0.1.x mounted the component as `selfHosting`; 0.2.x defaults to
 * `staticHosting`. A same-name migration that kept the legacy instance name
 * would otherwise force `--component selfHosting` on every command, and the
 * penalty for forgetting it used to be a confusing "component not found" bail.
 * Instead the CLI probes both names when the caller relied on the default, and
 * warns when it lands on the legacy one.
 */
export const DEFAULT_COMPONENT_NAME = "staticHosting";
export const LEGACY_COMPONENT_NAME = "selfHosting";

/**
 * Instance names to probe, in order, for a requested name.
 *
 * Only the default request expands to include the legacy name. Any other
 * requested name is used verbatim: an explicit custom name must never be
 * silently redirected to a different instance.
 */
export function componentNameCandidates(requested: string): string[] {
  if (requested !== DEFAULT_COMPONENT_NAME) return [requested];
  return [DEFAULT_COMPONENT_NAME, LEGACY_COMPONENT_NAME];
}

/** Warning shown once when a command resolves to the legacy instance name. */
export function legacyComponentNameWarning(name: string): string {
  return (
    `⚠️  Using the legacy component name "${name}" (the 0.1.x default; the ` +
    `current default is "${DEFAULT_COMPONENT_NAME}").\n` +
    `   This keeps working, but every deploy and upload has to keep passing ` +
    `--component ${name}. To drop the flag, rename the instance to ` +
    `"${DEFAULT_COMPONENT_NAME}" (see MIGRATION.md).`
  );
}
