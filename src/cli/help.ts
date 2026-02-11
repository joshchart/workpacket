export const MAIN_USAGE = `workpacket — convert assignment materials into structured Execution Packets

Usage:
  workpacket <command> [options]

Commands:
  build <assignment_dir>   Run the full pipeline (ingest → packet)
  ingest <assignment_dir>  Run only the ingest stage
  packet <assignment_id>   Generate packet from existing intermediates
  login                    Authenticate with ChatGPT (opens browser)

Options:
  --help, -h               Show this help message

Run "workpacket <command> --help" for command-specific options.`;

export const BUILD_USAGE = `workpacket build — run the full pipeline

Usage:
  workpacket build <assignment_dir> [options]

Arguments:
  <assignment_dir>         Path to the assignment materials directory

Options:
  --output <dir>           Output directory (default: workpacket_runs/<assignment_id>)
  --draft                  Enable draft generation stage
  --help, -h               Show this help message`;

export const INGEST_USAGE = `workpacket ingest — run only the ingest stage

Usage:
  workpacket ingest <assignment_dir> [options]

Arguments:
  <assignment_dir>         Path to the assignment materials directory

Options:
  --output <dir>           Output directory (default: workpacket_runs/<assignment_id>)
  --help, -h               Show this help message`;

export const PACKET_USAGE = `workpacket packet — generate packet from existing intermediates

Usage:
  workpacket packet <assignment_id> [options]

Arguments:
  <assignment_id>          ID of a previous run to generate packet from

Options:
  --output <dir>           Output directory (default: workpacket_runs/<assignment_id>)
  --help, -h               Show this help message`;
