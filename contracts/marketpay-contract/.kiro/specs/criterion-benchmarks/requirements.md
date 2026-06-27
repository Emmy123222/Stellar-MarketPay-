# Requirements Document

## Introduction

This feature adds Criterion-based performance benchmarks for the hot-path contract functions of the Stellar MarketPay Soroban smart contract. The benchmarks target `create_escrow`, `release_escrow`, and `partial_release` (the milestone-by-milestone approval path) at three milestone scales: 10, 100, and 1 000 milestones. Results are published as GitHub Actions artifacts on every CI run and a regression gate fails the build when any benchmark's mean execution time regresses by more than 20% compared with the stored baseline from the previous run.

Because the contract is built as a `cdylib` with `#![no_std]`, the benchmark binary must be a separate Cargo `[[bench]]` target that enables the `testutils` feature and drives the contract through the Soroban test environment rather than calling the WASM binary.

## Glossary

- **Bench_Binary**: The Criterion benchmark executable defined as a `[[bench]]` entry in `Cargo.toml` and located at `contracts/marketpay-contract/benches/escrow.rs`.
- **Benchmark_Group**: A named Criterion `BenchmarkGroup` that collects related timing samples for a single contract function at a given scale.
- **Baseline_File**: A Criterion JSON output file (`criterion/*/estimates.json`) stored as a GitHub Actions artifact and downloaded at the start of the next CI run for regression comparison.
- **CI_Workflow**: The GitHub Actions workflow defined in `.github/workflows/ci.yml`.
- **Criterion**: The `criterion` crate (≥ 0.5) used as the Rust benchmarking framework.
- **critcmp**: The `critcmp` CLI tool used to compare two sets of Criterion JSON outputs and surface regressions.
- **Regression_Gate**: The CI step that downloads the stored baseline, runs `critcmp`, and fails the build when any benchmark's mean time increases by more than 20%.
- **Scale**: The number of milestones used in a single benchmark iteration — one of 10, 100, or 1 000.
- **Soroban_Test_Env**: The `soroban_sdk::testutils` environment (`Env::default()`) used to execute contract functions in-process without deploying to a network.
- **Testutils_Feature**: The `testutils` Cargo feature that enables `soroban-sdk/testutils` for in-process contract invocation.

## Requirements

### Requirement 1: Benchmark Binary Setup

**User Story:** As a Rust developer, I want a dedicated benchmark binary that can be compiled and run independently of the contract WASM target, so that Criterion can use the standard library without conflicting with the `no_std` contract build.

#### Acceptance Criteria

1. THE Bench_Binary SHALL be declared as a `[[bench]]` entry named `escrow` in `contracts/marketpay-contract/Cargo.toml`.
2. THE Bench_Binary SHALL set `harness = false` in its `[[bench]]` declaration so Criterion controls the test harness.
3. WHEN the Bench_Binary is compiled, THE Cargo_Build_System SHALL enable the `testutils` feature automatically through a `bench` profile dependency or feature activation, so that `soroban-sdk/testutils` is available.
4. THE Bench_Binary SHALL add `criterion` (version ≥ 0.5) as a `dev-dependency` in `Cargo.toml` with the `html_reports` feature enabled.
5. THE Bench_Binary SHALL reside at `contracts/marketpay-contract/benches/escrow.rs`.
6. WHEN `cargo bench` is executed in `contracts/marketpay-contract`, THE Cargo_Toolchain SHALL compile and run only the benchmark binary without attempting to build the `cdylib` WASM target.

### Requirement 2: create_escrow Benchmarks

**User Story:** As a performance engineer, I want Criterion benchmarks for `create_escrow` at 10, 100, and 1 000 milestones, so that I can track how escrow creation cost scales with milestone count.

#### Acceptance Criteria

1. THE Bench_Binary SHALL contain a Benchmark_Group named `create_escrow` that measures the execution time of the `create_escrow` contract function.
2. WHEN running the `create_escrow` group, THE Bench_Binary SHALL execute one benchmark per Scale value in {10, 100, 1 000}, with each benchmark's parameter label equal to the Scale value (e.g., `"10"`, `"100"`, `"1000"`).
3. WHEN setting up each `create_escrow` benchmark iteration, THE Bench_Binary SHALL initialise a fresh Soroban_Test_Env, register the contract, mint sufficient token balance to the client address, and construct a milestone vector of the appropriate Scale.
4. THE Bench_Binary SHALL call `create_escrow` inside the Criterion measurement closure so that only the contract function execution time is measured, excluding setup.
5. WHEN `create_escrow` is called in a benchmark, THE Bench_Binary SHALL pass a valid `job_id`, `client` address, `freelancer` address, token address, amount equal to the sum of all milestone amounts, and the milestone vector.

### Requirement 3: release_escrow Benchmarks

**User Story:** As a performance engineer, I want Criterion benchmarks for `release_escrow` at 10, 100, and 1 000 milestones, so that I can track the cost of full escrow release as milestone count grows.

#### Acceptance Criteria

1. THE Bench_Binary SHALL contain a Benchmark_Group named `release_escrow` that measures the execution time of the `release_escrow` contract function.
2. WHEN running the `release_escrow` group, THE Bench_Binary SHALL execute one benchmark per Scale value in {10, 100, 1 000}.
3. WHEN setting up each `release_escrow` benchmark iteration, THE Bench_Binary SHALL create and start a fresh escrow (via `create_escrow` then `start_work`) in the setup phase so that the escrow is in `InProgress` status before the measurement closure begins.
4. THE Bench_Binary SHALL call `release_escrow` inside the Criterion measurement closure so that only the contract function execution time is measured.

### Requirement 4: partial_release (approve_milestone) Benchmarks

**User Story:** As a performance engineer, I want Criterion benchmarks for single-milestone approval (`partial_release`) at 10, 100, and 1 000 milestones, so that I can verify that per-milestone approval cost does not grow linearly with total milestone count.

#### Acceptance Criteria

1. THE Bench_Binary SHALL contain a Benchmark_Group named `approve_milestone` that measures the execution time of the `partial_release` contract function for a single milestone approval.
2. WHEN running the `approve_milestone` group, THE Bench_Binary SHALL execute one benchmark per Scale value in {10, 100, 1 000}.
3. WHEN setting up each `approve_milestone` benchmark iteration, THE Bench_Binary SHALL create and start a fresh escrow with the appropriate Scale of milestones in the setup phase.
4. THE Bench_Binary SHALL call `partial_release` for milestone index `0` inside the Criterion measurement closure so that only a single milestone approval is measured.
5. WHEN `partial_release` is called in a benchmark, THE Bench_Binary SHALL verify that it succeeds without panicking, confirming the Soroban_Test_Env accepted the call.

### Requirement 5: CI Artifact Upload

**User Story:** As a CI maintainer, I want benchmark results uploaded as GitHub Actions artifacts on every run, so that baseline files are available for regression comparison on the next PR.

#### Acceptance Criteria

1. THE CI_Workflow SHALL contain a `bench` step within the `contracts` job that executes `cargo bench` in `contracts/marketpay-contract` and redirects human-readable output to a file named `bench-output.txt`.
2. WHEN the `bench` step completes, THE CI_Workflow SHALL upload the Criterion JSON output directory (`contracts/marketpay-contract/target/criterion`) as a GitHub Actions artifact named `criterion-results` with a retention period of 30 days.
3. THE CI_Workflow SHALL also upload `bench-output.txt` as part of the `criterion-results` artifact so human-readable results are accessible from the Actions UI.
4. THE `bench` step SHALL run after the existing `cargo test` step and before `cargo build --release` in the `contracts` job.

### Requirement 6: Regression Gate

**User Story:** As a CI maintainer, I want the build to fail automatically when any benchmark regresses by more than 20% compared with the stored baseline, so that performance regressions are caught before merging.

#### Acceptance Criteria

1. THE CI_Workflow SHALL contain a `regression-check` step within the `contracts` job that runs after the `bench` step.
2. WHEN a previous `criterion-results` artifact exists for the target branch, THE regression-check step SHALL download it and use `critcmp` to compare the current results against the baseline.
3. WHEN `critcmp` reports that any benchmark's mean execution time has increased by more than 20% relative to the baseline, THE regression-check step SHALL exit with a non-zero code, causing the CI job to fail.
4. WHEN no previous `criterion-results` artifact exists (e.g., the first run on a new branch), THE regression-check step SHALL skip the comparison and pass, treating the current results as the new baseline.
5. THE regression-check step SHALL install `critcmp` via `cargo install critcmp --locked` if it is not already cached.
6. IF the regression-check step fails due to a detected regression, THEN THE CI_Workflow SHALL emit a human-readable summary listing each regressed benchmark name, its baseline mean, its current mean, and the percentage change.

### Requirement 7: Benchmark Isolation and Reproducibility

**User Story:** As a performance engineer, I want benchmarks to be isolated from network calls and non-deterministic state, so that results are reproducible across CI runners.

#### Acceptance Criteria

1. THE Bench_Binary SHALL use only the Soroban_Test_Env for contract execution — no calls to Stellar testnet, mainnet, or any external network endpoint are permitted.
2. WHEN each Criterion benchmark iteration begins, THE Bench_Binary SHALL construct a fresh Soroban_Test_Env instance so that state from prior iterations does not affect measurements.
3. THE Bench_Binary SHALL mock token transfers using the `soroban_sdk::testutils::Address` and the built-in mock token contract, so that fund movements are handled in-process without any real asset transfers.
4. THE Bench_Binary SHALL set Criterion's sample size to at least 10 samples per benchmark to produce statistically meaningful results within a reasonable CI time budget.
