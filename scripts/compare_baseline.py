#!/usr/bin/env python3
"""
Baseline comparison — the missing piece in most perf suites.

Compares the current k6 run's summary.json against a rolling baseline
computed from the last N runs stored in a results history file.

Why this matters:
  - Static thresholds (P95 < 500ms) miss slow degradation.
  - If your P95 was 80ms and is now 450ms, that's a 5x regression —
    but the test passes. This script catches it.
  - CI fails if any metric regresses beyond the configured % threshold.

Usage:
  python3 compare_baseline.py \\
    --current results/run_20240315_143022/summary.json \\
    --history results/baseline_history.json \\
    --window 10 \\
    --max-regression 20

  Exit codes:
    0 = all metrics within baseline tolerance
    1 = one or more metrics regressed beyond threshold
    2 = usage/IO error
"""

import argparse
import json
import sys
import os
from datetime import datetime
from pathlib import Path

# Metrics to track for regression detection
TRACKED_METRICS = [
    ('http_req_duration', 'p(95)'),
    ('http_req_duration', 'p(99)'),
    ('http_req_duration', 'med'),
    ('http_req_duration', 'avg'),
    ('http_req_failed', 'rate'),
    ('http_reqs', 'rate'),
    ('checks_failed_total', 'count'),
]


def load_json(path: str) -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[ERROR] File not found: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Invalid JSON in {path}: {e}", file=sys.stderr)
        sys.exit(2)


def save_json(data: dict, path: str):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def extract_metric(summary: dict, metric_name: str, stat: str) -> float | None:
    """Extract a single stat from k6's summary JSON format."""
    metrics = summary.get('metrics', {})
    metric = metrics.get(metric_name, {})
    values = metric.get('values', {})
    return values.get(stat)


def compute_baseline(history: list, window: int) -> dict:
    """Compute rolling average of each tracked metric over the last N runs."""
    recent = history[-window:]
    baseline = {}

    for metric_name, stat in TRACKED_METRICS:
        values = [
            run['metrics'].get(f'{metric_name}.{stat}')
            for run in recent
            if run['metrics'].get(f'{metric_name}.{stat}') is not None
        ]
        if values:
            baseline[f'{metric_name}.{stat}'] = {
                'avg': sum(values) / len(values),
                'min': min(values),
                'max': max(values),
                'samples': len(values),
            }

    return baseline


def build_run_record(summary: dict, run_id: str) -> dict:
    """Extract all tracked metrics from a summary into a flat record."""
    record = {
        'run_id': run_id,
        'timestamp': datetime.utcnow().isoformat(),
        'metrics': {},
    }

    for metric_name, stat in TRACKED_METRICS:
        val = extract_metric(summary, metric_name, stat)
        if val is not None:
            record['metrics'][f'{metric_name}.{stat}'] = val

    return record


def compare(current_record: dict, baseline: dict, max_regression_pct: float) -> list:
    """Return list of regression findings."""
    regressions = []

    for key, baseline_data in baseline.items():
        current_val = current_record['metrics'].get(key)
        if current_val is None:
            continue

        baseline_avg = baseline_data['avg']
        if baseline_avg == 0:
            continue

        change_pct = ((current_val - baseline_avg) / baseline_avg) * 100

        # For error rate and latency, increase = regression
        # For throughput (http_reqs.rate), decrease = regression
        is_throughput = 'http_reqs.rate' in key
        regressed = (
            change_pct < -max_regression_pct if is_throughput
            else change_pct > max_regression_pct
        )

        regressions.append({
            'metric': key,
            'current': current_val,
            'baseline_avg': round(baseline_avg, 4),
            'change_pct': round(change_pct, 2),
            'baseline_samples': baseline_data['samples'],
            'regressed': regressed,
        })

    return regressions


def print_table(regressions: list):
    """Print a formatted comparison table."""
    print(f"\n{'Metric':<45} {'Current':>12} {'Baseline':>12} {'Change':>10} {'Status':>8}")
    print('-' * 95)

    for r in sorted(regressions, key=lambda x: x['metric']):
        status = 'REGRESSED' if r['regressed'] else 'OK'
        sign = '+' if r['change_pct'] >= 0 else ''
        print(
            f"{r['metric']:<45} "
            f"{r['current']:>12.4f} "
            f"{r['baseline_avg']:>12.4f} "
            f"{sign}{r['change_pct']:>9.1f}% "
            f"{'❌ ' + status if r['regressed'] else '✓  ' + status:>8}"
        )

    print()


def main():
    parser = argparse.ArgumentParser(description='Compare k6 run against rolling baseline')
    parser.add_argument('--current', required=True, help='Path to current run summary.json')
    parser.add_argument('--history', required=True, help='Path to baseline history JSON file')
    parser.add_argument('--window', type=int, default=10, help='Rolling window size (default: 10)')
    parser.add_argument('--max-regression', type=float, default=20.0,
                        help='Max allowed regression percentage (default: 20)')
    parser.add_argument('--run-id', default=None, help='Run identifier for history record')
    parser.add_argument('--output', default=None, help='Write comparison report to JSON file')
    args = parser.parse_args()

    run_id = args.run_id or datetime.utcnow().strftime('%Y%m%d_%H%M%S')

    # Load current run
    current_summary = load_json(args.current)
    current_record = build_run_record(current_summary, run_id)

    print(f"[baseline] Run ID: {run_id}")
    print(f"[baseline] Window: last {args.window} runs")
    print(f"[baseline] Max regression: {args.max_regression}%")

    # Load or initialize history
    history = []
    if os.path.exists(args.history):
        history_data = load_json(args.history)
        history = history_data.get('runs', [])
        print(f"[baseline] Loaded {len(history)} historical runs")
    else:
        print('[baseline] No history file found — this run will become the baseline')

    report = {
        'run_id': run_id,
        'timestamp': current_record['timestamp'],
        'current_metrics': current_record['metrics'],
        'baseline_window': args.window,
        'regressions': [],
        'passed': True,
    }

    if len(history) >= 3:
        baseline = compute_baseline(history, args.window)
        regressions = compare(current_record, baseline, args.max_regression)

        print_table(regressions)

        failed = [r for r in regressions if r['regressed']]
        report['regressions'] = regressions
        report['passed'] = len(failed) == 0

        if failed:
            print(f"[baseline] FAILED — {len(failed)} metric(s) regressed beyond {args.max_regression}%:")
            for r in failed:
                print(f"  - {r['metric']}: {r['current']:.4f} vs baseline {r['baseline_avg']:.4f} ({r['change_pct']:+.1f}%)")
        else:
            print(f"[baseline] PASSED — all {len(regressions)} metrics within {args.max_regression}% of baseline")
    else:
        print(f'[baseline] Not enough history ({len(history)} runs) for comparison. Need at least 3.')
        print('[baseline] Storing this run as baseline data.')

    # Append current run to history
    history.append(current_record)
    save_json({'runs': history}, args.history)
    print(f'[baseline] History updated ({len(history)} total runs)')

    if args.output:
        save_json(report, args.output)
        print(f'[baseline] Report written to {args.output}')

    sys.exit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
