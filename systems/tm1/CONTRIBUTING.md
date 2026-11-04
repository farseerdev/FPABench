# Contributing

Corrections and improvements are welcome by issue or pull request.

## What you may contribute

- Only code, text or data that you wrote yourself or have the right to license under this repository's
  terms (Apache License 2.0 for code; CC BY 4.0 for material derived from FPABench).
- Say where anything not written by you comes from, and under which licence.
- Do not submit IBM software or anything taken from it: no server or client binaries, libraries, exported
  TM1 server data folders, files saved by a TM1 server (`.pro`, `.cub`, `.dim`, `.rux` saved by the server,
  and so on), IBM sample code, decompiled or disassembled material, or confidential IBM documentation.
  Processes are contributed as `.ti` sources and rules as hand-written `.rux` text.
- Do not submit benchmark results unless you can disclose everything listed in
  [docs/BENCHMARK_METHODOLOGY.md](docs/BENCHMARK_METHODOLOGY.md). Before publishing performance measurements
  or comparative benchmark results, users must review the licence terms applicable to their IBM software
  installation, including any restrictions on performance testing or disclosure, and obtain any
  authorisation required by those terms.
- Do not describe this project as tested, compatible, performance-validated or IBM-certified unless the
  repository holds evidence for that statement.
- Do not commit configuration files with server addresses, user names or passwords (`.gitignore` excludes
  `scripts/FPBench.config.psd1`).

## How

- Keep the FPABench model's meaning: a change to rules or processes must not change the answers that
  `compare.mjs` checks, unless it fixes a documented mismatch with the FPABench model.
- Describe what you changed and why, which TM1 / Planning Analytics version you used, and what you ran to
  check it (for example `compare.mjs` on the answers).
- If you used AI assistance, say so in the pull request.

Following this guide does not by itself make a contribution compliant with any licence; you remain
responsible for what you submit.
