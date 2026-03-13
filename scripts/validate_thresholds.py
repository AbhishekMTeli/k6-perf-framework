#!/usr/bin/env python3
"""
Validate JMeter test results against performance thresholds.
Exits with code 1 if any threshold is breached (causes CI/CD build to fail).

Usage:
    python3 validate_thresholds.py \
        --error-rate 1.5 \
        --avg-rt 800 \
        --p95-rt 2200 \
        --max-error-rate 2.0 \
        --max-avg-rt 2000 \
        --max-p95-rt 5000
"""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description="Validate performance thresholds")
    parser.add_argument("--error-rate",    type=float, required=True)
    parser.add_argument("--avg-rt",        type=float, required=True)
    parser.add_argument("--p95-rt",        type=float, required=True)
    parser.add_argument("--throughput",    type=float, default=0)
    parser.add_argument("--max-error-rate",    type=float, default=2.0)
    parser.add_argument("--max-avg-rt",        type=float, default=2000)
    parser.add_argument("--max-p95-rt",        type=float, default=5000)
    parser.add_argument("--min-throughput",    type=float, default=0)
    args = parser.parse_args()

    failures = []

    checks = [
        (args.error_rate,  "<=", args.max_error_rate,  "Error Rate",           "%"),
        (args.avg_rt,      "<=", args.max_avg_rt,       "Avg Response Time",    "ms"),
        (args.p95_rt,      "<=", args.max_p95_rt,       "P95 Response Time",    "ms"),
    ]
    if args.min_throughput > 0:
        checks.append((args.throughput, ">=", args.min_throughput, "Throughput", "req/s"))

    print("\n=== Threshold Validation ===")
    for actual, op, threshold, name, unit in checks:
        if op == "<=" and actual <= threshold:
            status = "PASS"
        elif op == ">=" and actual >= threshold:
            status = "PASS"
        else:
            status = "FAIL"
            failures.append(f"{name}: {actual}{unit} (threshold: {op}{threshold}{unit})")

        print(f"  [{status}] {name}: {actual}{unit} (threshold {op}{threshold}{unit})")

    if failures:
        print(f"\nFAILED - {len(failures)} threshold(s) exceeded:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("\nAll thresholds passed!")
        sys.exit(0)


if __name__ == "__main__":
    main()
