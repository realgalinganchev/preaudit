#!/usr/bin/env bash
# Mutation testing: generate mutants with Gambit, run the test suite against each,
# and record whether the tests caught ("killed") the change.
#
# Usage: mutation-test <solc-version> <results.jsonl> <file.sol>...
# Env:   NUM_MUTANTS  downsample to at most this many mutants per file (optional)
#        TEST_ARGS    extra `forge test` arguments, e.g. to leave out the harness (optional)
# Runs in the current directory, which must be a disposable copy of the project.
set -uo pipefail
set -f  # TEST_ARGS carries a glob for forge (test/preaudit/**); bash must not expand it
TEST_ARGS="${TEST_ARGS:-}"

SOLC_VERSION="$1"; RESULTS="$2"; shift 2
export SOLC_VERSION
solc-select install "$SOLC_VERSION" >/dev/null 2>&1 || true

: > "$RESULTS"
note() { printf '{"error":"%s"}\n' "$1" >> "$RESULTS"; }

# Windows checkouts have CRLF line endings; Gambit writes LF mutants, which would make every
# diff span the whole file. This runs on a disposable copy, so normalizing is safe.
for FILE in "$@"; do sed -i 's/\r$//' "$FILE"; done

forge build >/dev/null 2>&1 || { note "baseline build failed"; exit 1; }
forge test $TEST_ARGS >/dev/null 2>&1 || { note "baseline tests fail, so a mutation score would be meaningless"; exit 1; }

REMAPS=()
while IFS= read -r line; do
  [ -n "$line" ] && REMAPS+=(--solc_remappings "$line")
done < <(forge remappings 2>/dev/null)

n=0
for FILE in "$@"; do
  n=$((n + 1))
  rm -rf gambit_out
  if ! gambit mutate --filename "$FILE" --solc solc "${REMAPS[@]}" \
         ${NUM_MUTANTS:+--num_mutants "$NUM_MUTANTS"} > gambit.log 2>&1; then
    note "gambit failed on $FILE: $(tail -c 300 gambit.log | tr '\n"' ' \047')"
    continue
  fi
  cp gambit_out/gambit_results.json "$(dirname "$RESULTS")/gambit_results_$n.json"
  cp "$FILE" /tmp/original.sol

  # gambit_results.json lists each mutant's id and the path of its mutated file
  python3 -c 'import json,sys; [print(m["id"], m["name"]) for m in json.load(open("gambit_out/gambit_results.json"))]' |
  while read -r id name; do
    cp "gambit_out/$name" "$FILE"
    if timeout 300 forge test $TEST_ARGS >/dev/null 2>&1; then status=survived; else status=killed; fi
    printf '{"file":"%s","id":"%s","status":"%s"}\n' "$FILE" "$id" "$status" >> "$RESULTS"
  done

  cp /tmp/original.sol "$FILE"
done
