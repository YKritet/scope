#!/usr/bin/env bats

NODE="$(command -v node || echo ~/.nvm/versions/node/v24.15.0/bin/node)"
CLI="$NODE $(dirname "$BATS_TEST_FILENAME")/../src/index.js"

@test "outputs version" {
  run $CLI --version
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]
}

@test "static table exits 0" {
  run $CLI
  [ "$status" -eq 0 ]
}

@test "--json outputs valid JSON array" {
  run $CLI --json
  [ "$status" -eq 0 ]
  run bash -c "echo '$output' | jq -e 'type == \"array\"'"
  [ "$status" -eq 0 ]
}

@test "--json entries have required fields" {
  run $CLI --json
  [ "$status" -eq 0 ]
  run bash -c "echo '$output' | jq -e '.[0] | has(\"port\") and has(\"processName\") and has(\"source\")'"
  [ "$status" -eq 0 ]
}

@test "kill missing port exits non-zero" {
  run $CLI kill
  [ "$status" -ne 0 ] || [[ "$output" == *"Usage"* ]]
}

@test "inspect unknown port prints error" {
  run $CLI 1
  [ "$status" -eq 0 ]
  [[ "$output" == *"No service"* ]]
}

@test "help text shows all commands" {
  run $CLI --help 2>&1 || run $CLI unknown-command 2>&1
  [[ "$output" == *"tui"* ]]
  [[ "$output" == *"kill"* ]]
  [[ "$output" == *"json"* ]]
}
