#!/usr/bin/env python3
"""
Parse JMeter JTL results file and extract performance metrics.
Outputs JSON with key metrics used for threshold validation in CI/CD.

Usage:
    python3 parse_results.py results.jtl
    python3 parse_results.py results.jtl --output metrics.json --format json
"""

import csv
import json
import sys
import argparse
import statistics
from pathlib import Path
from collections import defaultdict


def parse_jtl(filepath: str) -> dict:
    """Parse JMeter JTL (CSV format) and return metrics dict."""
    response_times = []
    latencies = []
    errors = 0
    total = 0
    labels = defaultdict(lambda: {"times": [], "errors": 0, "count": 0})
    start_ts = None
    end_ts = None

    with open(filepath, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        for row in reader:
            total += 1
            ts = int(row.get('timeStamp', 0))
            elapsed = int(row.get('elapsed', 0))
            label = row.get('label', 'Unknown')
            success = row.get('success', 'true').lower() == 'true'
            latency = int(row.get('Latency', 0))

            if start_ts is None or ts < start_ts:
                start_ts = ts
            if end_ts is None or ts > end_ts:
                end_ts = ts

            response_times.append(elapsed)
            latencies.append(latency)
            labels[label]["times"].append(elapsed)
            labels[label]["count"] += 1

            if not success:
                errors += 1
                labels[label]["errors"] += 1

    if not response_times:
        return {"error": "No results found in JTL file"}

    # Calculate duration in seconds
    duration_ms = (end_ts - start_ts) if start_ts and end_ts else 1
    duration_s = max(duration_ms / 1000, 1)

    sorted_times = sorted(response_times)
    n = len(sorted_times)

    def percentile(data, pct):
        idx = int(len(data) * pct / 100)
        return data[min(idx, len(data) - 1)]

    # Per-label breakdown
    label_stats = {}
    for lbl, data in labels.items():
        t = sorted(data["times"])
        label_stats[lbl] = {
            "count": data["count"],
            "errors": data["errors"],
            "error_rate": round(data["errors"] / data["count"] * 100, 2) if data["count"] else 0,
            "avg_response_time": round(statistics.mean(t), 2) if t else 0,
            "min_response_time": min(t) if t else 0,
            "max_response_time": max(t) if t else 0,
            "p90_response_time": percentile(t, 90),
            "p95_response_time": percentile(t, 95),
            "p99_response_time": percentile(t, 99),
        }

    metrics = {
        "total_requests": total,
        "total_errors": errors,
        "error_rate": round(errors / total * 100, 2) if total else 0,
        "throughput": round(total / duration_s, 2),
        "avg_response_time": round(statistics.mean(response_times), 2),
        "median_response_time": percentile(sorted_times, 50),
        "p90_response_time": percentile(sorted_times, 90),
        "p95_response_time": percentile(sorted_times, 95),
        "p99_response_time": percentile(sorted_times, 99),
        "min_response_time": min(response_times),
        "max_response_time": max(response_times),
        "std_dev": round(statistics.stdev(response_times), 2) if len(response_times) > 1 else 0,
        "avg_latency": round(statistics.mean(latencies), 2) if latencies else 0,
        "test_duration_seconds": round(duration_s, 2),
        "labels": label_stats,
    }

    return metrics


def main():
    parser = argparse.ArgumentParser(description="Parse JMeter JTL results")
    parser.add_argument("jtl_file", help="Path to JTL results file")
    parser.add_argument("--output", "-o", help="Output file (default: stdout)")
    parser.add_argument("--format", "-f", choices=["json", "text"], default="json")
    args = parser.parse_args()

    if not Path(args.jtl_file).exists():
        print(f"ERROR: File not found: {args.jtl_file}", file=sys.stderr)
        sys.exit(1)

    metrics = parse_jtl(args.jtl_file)

    if args.format == "json":
        output = json.dumps(metrics, indent=2)
    else:
        output = f"""
Performance Test Results
========================
Total Requests  : {metrics['total_requests']}
Total Errors    : {metrics['total_errors']}
Error Rate      : {metrics['error_rate']}%
Throughput      : {metrics['throughput']} req/s
Test Duration   : {metrics['test_duration_seconds']}s

Response Times (ms)
-------------------
Average  : {metrics['avg_response_time']}
Median   : {metrics['median_response_time']}
P90      : {metrics['p90_response_time']}
P95      : {metrics['p95_response_time']}
P99      : {metrics['p99_response_time']}
Min      : {metrics['min_response_time']}
Max      : {metrics['max_response_time']}
Std Dev  : {metrics['std_dev']}
"""

    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
        print(f"Metrics written to: {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
