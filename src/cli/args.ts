export interface UploadArgs {
  dist: string;
  component: string;
  prod: boolean;
  build: boolean;
  buildCommand: string;
  cdn: boolean;
  cdnDeleteFunction: string;
  concurrency: number;
  spaFallback: boolean;
  help: boolean;
}

export interface DeployArgs {
  dist: string;
  component: string;
  help: boolean;
  skipBuild: boolean;
  skipConvex: boolean;
  cdn: boolean;
  cdnDeleteFunction: string;
  spaFallback: boolean;
  buildCommand: string;
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseUploadArgs(args: string[]): UploadArgs {
  const result: UploadArgs = {
    dist: "./dist",
    component: "staticHosting",
    prod: false,
    build: false,
    buildCommand: "npm run build",
    cdn: false,
    cdnDeleteFunction: "",
    concurrency: 5,
    spaFallback: true,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--dist" || arg === "-d") {
      result.dist = optionValue(args, i, arg);
      i++;
    } else if (arg === "--component" || arg === "-c") {
      result.component = optionValue(args, i, arg);
      i++;
    } else if (arg === "--prod") {
      result.prod = true;
    } else if (arg === "--no-prod" || arg === "--dev") {
      result.prod = false;
    } else if (arg === "--build" || arg === "-b") {
      result.build = true;
    } else if (arg === "--build-command") {
      result.buildCommand = optionValue(args, i, arg);
      result.build = true;
      i++;
    } else if (arg === "--no-spa") {
      result.spaFallback = false;
    } else if (arg === "--spa") {
      result.spaFallback = true;
    } else if (arg === "--cdn") {
      result.cdn = true;
    } else if (arg === "--cdn-delete-function") {
      result.cdnDeleteFunction = optionValue(args, i, arg);
      i++;
    } else if (arg === "--concurrency" || arg === "-j") {
      const value = optionValue(args, i, arg);
      const concurrency = Number(value);
      if (!Number.isInteger(concurrency) || concurrency <= 0) {
        throw new Error(`${arg} must be a positive integer`);
      }
      result.concurrency = concurrency;
      i++;
    } else {
      throw new Error(`Unknown upload option: ${arg}`);
    }
  }
  return result;
}

export function parseDeployArgs(args: string[]): DeployArgs {
  const result: DeployArgs = {
    dist: "./dist",
    component: "staticHosting",
    help: false,
    skipBuild: false,
    skipConvex: false,
    cdn: false,
    cdnDeleteFunction: "",
    spaFallback: true,
    buildCommand: "npm run build",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--dist" || arg === "-d") {
      result.dist = optionValue(args, i, arg);
      i++;
    } else if (arg === "--component" || arg === "-c") {
      result.component = optionValue(args, i, arg);
      i++;
    } else if (arg === "--skip-build") {
      result.skipBuild = true;
    } else if (arg === "--skip-convex") {
      result.skipConvex = true;
    } else if (arg === "--cdn") {
      result.cdn = true;
    } else if (arg === "--cdn-delete-function") {
      result.cdnDeleteFunction = optionValue(args, i, arg);
      i++;
    } else if (arg === "--no-spa") {
      result.spaFallback = false;
    } else if (arg === "--spa") {
      result.spaFallback = true;
    } else if (arg === "--build-command") {
      result.buildCommand = optionValue(args, i, arg);
      i++;
    } else {
      throw new Error(`Unknown deploy option: ${arg}`);
    }
  }
  return result;
}

export function buildDeployUploadArgs(args: DeployArgs): string[] {
  const uploadArgs = [
    "upload",
    "--dist",
    args.dist,
    "--component",
    args.component,
    "--prod",
  ];
  if (args.cdn) uploadArgs.push("--cdn");
  if (args.cdnDeleteFunction) {
    uploadArgs.push("--cdn-delete-function", args.cdnDeleteFunction);
  }
  if (!args.spaFallback) uploadArgs.push("--no-spa");
  return uploadArgs;
}
