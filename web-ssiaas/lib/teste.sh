time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=1 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_001.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=6 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_006.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=12 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_012.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=24 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_024.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=48 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_048.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=96 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_096.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=192 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_192.html

time WARMUP_ITERATIONS=10 ITERATIONS=1000 THREADS=230 node verify-benchmark.js
mv metrics-verify-report.html metrics_stress_verify/metrics-verify-report_230.html

