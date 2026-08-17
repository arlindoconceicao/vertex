# Post-Quantum Cryptography Benchmark (SSI-PQ)

## Overview
This directory (`lib/`) contains a suite of tools designed to measure the performance (execution times, hardware resource usage) and storage overhead (artifact sizes) of the post-quantum cryptographic operations integrated into the `ssi_pq_core.node` library.

The evaluated algorithms include:
- **ML-KEM (Kyber):** For key encapsulation and shared secret establishment.
- **ML-DSA (Dilithium):** For issuing and verifying digital signatures in credentials.

## Available Benchmark Tools

### 1. General Metrics (`lib/metrics-benchmark.js`)
Measures the average time and general overhead of the full credential lifecycle (key generation, schema, signature, PDF generation, encryption, and decapsulation).

```bash
WARMUP_ITERATIONS=5 ITERATIONS=100 THREADS=10 node lib/metrics-benchmark.js
```
- **Output:** `lib/metrics_output/metrics-report.html`

### 2. Verification Stress Test (`lib/verify-benchmark.js`)
Performs a massive stress test (simulating high server load) focused solely on **verifying signed PDFs**. It measures *throughput* (verifications per second) by intelligently dividing the total iterations across active threads. Includes active monitoring of RAM consumption and percentage usage for each logical CPU core.

```bash
WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=12 node lib/verify-benchmark.js
```
- **Output:** `lib/metrics_output/metrics-verify-report.html`

### 3. Size Scalability (`lib/size-benchmark.js`)
Analyzes the data structure overhead (Schema, Signed Credential, Base PDF, and Encrypted PDF), evaluating how these artifacts grow in bytes as the original credential attribute size (payload) scales from **1 KB up to 1 MB**. (Sequential execution without the need for environment variables).

```bash
node lib/size-benchmark.js
```
- **Output:** `lib/metrics_output/size-benchmark-report.html`

## Global Environment Variables
Performance tools (`metrics-benchmark` and `verify-benchmark`) support the following environment parameters:

- `ITERATIONS` (default: 10): Defines the total number of iterations for which metrics will be collected. In the verification test, this total number is evenly divided and distributed across threads.
- `WARMUP_ITERATIONS` (default: 0): Defines the number of warmup (discarded) iterations executed in each thread before data collection begins. It is highly recommended to use at least `5` to ensure the CPU/caches are properly warmed up.
- `THREADS` (default: 1): Defines the number of concurrent threads launched via `node:worker_threads`. To extract maximum throughput, it is suggested not to exceed the host machine's number of physical cores.
