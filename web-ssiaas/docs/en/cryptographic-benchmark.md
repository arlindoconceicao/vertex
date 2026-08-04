# Post-Quantum Cryptography Benchmark (SSI-PQ)

## Overview
This document describes the usage of the cryptographic benchmark script located at `lib/metrics-benchmark.js`. The script's objective is to measure the performance (execution times) and storage overhead (artifact sizes) of the post-quantum cryptographic operations integrated into the `ssi_pq_core.node` library.

The evaluated algorithms include:
- **ML-KEM (Kyber):** For key encapsulation and shared secret establishment.
- **ML-DSA (Dilithium):** For issuing and verifying digital signatures in credentials.

## How to Run
The script allows parameter configuration via environment variables, enabling flexible settings for iterations, warmup, and multi-threading.

```bash
WARMUP_ITERATIONS=5 ITERATIONS=100 THREADS=10 node lib/metrics-benchmark.js
```

### Environment Variables
- `ITERATIONS` (default: 10): Sets the number of iterations whose metrics will be collected and processed for average and standard deviation calculations.
- `WARMUP_ITERATIONS` (default: 0): Sets the number of iterations executed before data collection begins. It is highly recommended to use at least `5` to ensure CPU/caches are warmed up, improving the accuracy of the collected measurements.
- `THREADS` (default: 1): Sets the amount of concurrent threads to accelerate test execution using the `node:worker_threads` API.

## Generated Report
Upon successful completion, the script generates a static HTML file (`lib/metrics-report.html`) containing:
- **Machine Information:** CPU, RAM, and Operating System details.
- **Execution Times Table (in ms):** Average and standard deviation for functions such as schema generation, credential issuance, signatures, AES-256-GCM encryption, verification, and decapsulation. Metrics are grouped into security profiles: Level 1 (128-bit), Level 3 (192-bit), and Level 5 (256-bit).
- **Sizes Table (in KB):** Comparison of the original JSON credential size versus the signed credential, the schema, and the final PDF encapsulated with ML-KEM/AES.
