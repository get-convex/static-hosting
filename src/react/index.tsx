"use client";

import { useQuery_experimental } from "convex/react";
import { useState, useMemo, type CSSProperties, type JSX } from "react";
import { makeFunctionReference, type FunctionReference } from "convex/server";

type DeploymentInfo = {
  _id: string;
  _creationTime: number;
  currentDeploymentId: string;
  deployedAt: number;
} | null;

type DeploymentQueryRef = FunctionReference<
  "query",
  "public",
  Record<string, never>,
  DeploymentInfo
>;

const DEFAULT_QUERY_REF = makeFunctionReference<
  "query",
  Record<string, never>,
  DeploymentInfo
>("staticHosting:getCurrentDeployment") as DeploymentQueryRef;

/* eslint-disable react-refresh/only-export-components */

/**
 * Hook to detect when a new deployment is available.
 *
 * @param getCurrentDeployment - Optional query reference. Defaults to
 *   `api.staticHosting.getCurrentDeployment` (resolved by path). If you've
 *   re-exported the deployment query under a different module name, pass the
 *   reference explicitly.
 *
 * @example
 * ```tsx
 * import { useDeploymentUpdates } from "@convex-dev/static-hosting/react";
 *
 * function App() {
 *   const { updateAvailable, reload } = useDeploymentUpdates();
 *   return updateAvailable ? <button onClick={reload}>Reload</button> : null;
 * }
 * ```
 */
export function useDeploymentUpdates(
  getCurrentDeployment?: DeploymentQueryRef,
) {
  const result = useQuery_experimental({
    query: getCurrentDeployment ?? DEFAULT_QUERY_REF,
    args: {},
  });

  const deployment = result.status === "success" ? result.data : null;
  const setupError =
    result.status === "error"
      ? deploymentQuerySetupHelp(getCurrentDeployment)
      : null;

  const [initialDeploymentId, setInitialDeploymentId] = useState<string | null>(
    null,
  );
  const [dismissedDeploymentId, setDismissedDeploymentId] = useState<
    string | null
  >(null);

  if (deployment && initialDeploymentId === null) {
    setInitialDeploymentId(deployment.currentDeploymentId);
  }

  const updateAvailable = useMemo(() => {
    if (!deployment || initialDeploymentId === null) return false;
    const hasNew = deployment.currentDeploymentId !== initialDeploymentId;
    const isDismissed =
      deployment.currentDeploymentId === dismissedDeploymentId;
    return hasNew && !isDismissed;
  }, [deployment, initialDeploymentId, dismissedDeploymentId]);

  const reload = () => {
    window.location.reload();
  };

  const dismiss = () => {
    if (deployment) {
      setDismissedDeploymentId(deployment.currentDeploymentId);
    }
  };

  return {
    updateAvailable,
    reload,
    dismiss,
    deployment,
    /**
     * When set, the deployment query isn't exported from the app — the banner
     * won't work until the user wires it up. The string is suitable to render
     * during local development so the missing setup is obvious.
     */
    setupError,
  };
}

function deploymentQuerySetupHelp(ref: DeploymentQueryRef | undefined): string {
  if (ref) {
    return "Deployment query failed. Verify the function you passed to useDeploymentUpdates is deployed.";
  }
  return [
    "@convex-dev/static-hosting: UpdateBanner requires you to expose the deployment query.",
    "Create convex/staticHosting.ts:",
    "",
    '  import { exposeDeploymentQuery } from "@convex-dev/static-hosting";',
    '  import { components } from "./_generated/api";',
    "  export const { getCurrentDeployment } = exposeDeploymentQuery(",
    "    components.staticHosting,",
    "  );",
  ].join("\n");
}

/**
 * Ready-to-use banner shown when a new deployment is available.
 *
 * @example
 * ```tsx
 * import { UpdateBanner } from "@convex-dev/static-hosting/react";
 * <UpdateBanner />
 * ```
 */
export function UpdateBanner({
  getCurrentDeployment,
  message = "A new version is available!",
  buttonText = "Reload",
  dismissable = true,
  className,
  style,
}: {
  getCurrentDeployment?: DeploymentQueryRef;
  message?: string;
  buttonText?: string;
  dismissable?: boolean;
  className?: string;
  style?: CSSProperties;
} = {}): JSX.Element | null {
  const { updateAvailable, reload, dismiss, setupError } =
    useDeploymentUpdates(getCurrentDeployment);

  if (setupError) {
    if (typeof console !== "undefined") {
      console.warn(setupError);
    }
    return null;
  }

  if (!updateAvailable) return null;

  const defaultStyle: CSSProperties = {
    position: "fixed",
    bottom: "1rem",
    right: "1rem",
    backgroundColor: "#1a1a2e",
    color: "#fff",
    padding: "1rem 1.5rem",
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    zIndex: 9999,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "14px",
    ...style,
  };

  const buttonStyle: CSSProperties = {
    backgroundColor: "#4f46e5",
    color: "#fff",
    border: "none",
    padding: "0.5rem 1rem",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 500,
  };

  const dismissStyle: CSSProperties = {
    background: "none",
    border: "none",
    color: "#888",
    cursor: "pointer",
    padding: "0.25rem",
    fontSize: "18px",
    lineHeight: 1,
  };

  return (
    <div className={className} style={defaultStyle}>
      <span>{message}</span>
      <button onClick={reload} style={buttonStyle}>
        {buttonText}
      </button>
      {dismissable && (
        <button onClick={dismiss} style={dismissStyle} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
