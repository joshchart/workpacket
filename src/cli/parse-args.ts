export type BuildArgs = {
  command: "build";
  assignmentDir: string;
  outputDir?: string;
  draft: boolean;
};

export type IngestArgs = {
  command: "ingest";
  assignmentDir: string;
  outputDir?: string;
};

export type PacketArgs = {
  command: "packet";
  assignmentId: string;
  outputDir?: string;
};

export type HelpArgs = {
  command: "help";
};

export type LoginArgs = {
  command: "login";
};

export type ParsedArgs = BuildArgs | IngestArgs | PacketArgs | HelpArgs | LoginArgs;

export type ParseError = {
  error: string;
  usage?: string;
};

export type ParseResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: ParseError };

function extractOutput(
  args: string[],
): { outputDir?: string; rest: string[] } {
  const rest: string[] = [];
  let outputDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--output" || arg === "-o") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        // Will be handled as missing value by caller — skip
        rest.push(arg);
        continue;
      }
      outputDir = next;
      i++; // skip next
    } else if (arg.startsWith("--output=")) {
      outputDir = arg.slice("--output=".length);
    } else {
      rest.push(arg);
    }
  }

  return { outputDir, rest };
}

function parseBuildArgs(args: string[]): ParseResult {
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, args: { command: "help" } };
  }

  const { outputDir, rest } = extractOutput(args);

  const draft = rest.includes("--draft");
  const positionals = rest.filter((a) => !a.startsWith("-"));

  const assignmentDir = positionals[0];
  if (!assignmentDir) {
    return {
      ok: false,
      error: {
        error: "Missing required argument: <assignment_dir>",
        usage: 'Run "workpacket build --help" for usage information.',
      },
    };
  }

  return {
    ok: true,
    args: { command: "build", assignmentDir, outputDir, draft },
  };
}

function parseIngestArgs(args: string[]): ParseResult {
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, args: { command: "help" } };
  }

  const { outputDir, rest } = extractOutput(args);
  const positionals = rest.filter((a) => !a.startsWith("-"));

  const assignmentDir = positionals[0];
  if (!assignmentDir) {
    return {
      ok: false,
      error: {
        error: "Missing required argument: <assignment_dir>",
        usage: 'Run "workpacket ingest --help" for usage information.',
      },
    };
  }

  return {
    ok: true,
    args: { command: "ingest", assignmentDir, outputDir },
  };
}

function parsePacketArgs(args: string[]): ParseResult {
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, args: { command: "help" } };
  }

  const { outputDir, rest } = extractOutput(args);
  const positionals = rest.filter((a) => !a.startsWith("-"));

  const assignmentId = positionals[0];
  if (!assignmentId) {
    return {
      ok: false,
      error: {
        error: "Missing required argument: <assignment_id>",
        usage: 'Run "workpacket packet --help" for usage information.',
      },
    };
  }

  return {
    ok: true,
    args: { command: "packet", assignmentId, outputDir },
  };
}

export function parseArgs(argv: string[]): ParseResult {
  // argv[0] = bun, argv[1] = script path, argv[2+] = user args
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { ok: true, args: { command: "help" } };
  }

  const command = args[0];

  switch (command) {
    case "build":
      return parseBuildArgs(args.slice(1));
    case "ingest":
      return parseIngestArgs(args.slice(1));
    case "packet":
      return parsePacketArgs(args.slice(1));
    case "login":
      return { ok: true, args: { command: "login" } };
    default:
      return {
        ok: false,
        error: {
          error: `Unknown command: ${command}`,
          usage: 'Run "workpacket --help" for usage information.',
        },
      };
  }
}
