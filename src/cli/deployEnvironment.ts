export interface DeploymentUrls {
  siteUrl: string;
  cloudUrl: string;
}

export function buildEnvironment(urls: DeploymentUrls) {
  return {
    cloudUrl: urls.cloudUrl,
    basePath: new URL(urls.siteUrl).pathname || "/",
  };
}

export function buildEnvironmentChanged(
  before: DeploymentUrls,
  after: DeploymentUrls,
): boolean {
  const previous = buildEnvironment(before);
  const next = buildEnvironment(after);
  return (
    previous.cloudUrl !== next.cloudUrl || previous.basePath !== next.basePath
  );
}
