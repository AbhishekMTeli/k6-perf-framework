#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# run_tests.sh  –  Local JMeter test runner
# Usage:
#   ./scripts/run_tests.sh [OPTIONS]
#
# Options:
#   -t, --test-type     load | stress | spike        (default: load)
#   -u, --base-url      Target host                  (default: localhost)
#   -p, --port          Target port                  (default: 8080)
#   -n, --threads       Concurrent users             (default: 50)
#   -r, --ramp-up       Ramp-up seconds              (default: 30)
#   -d, --duration      Test duration seconds        (default: 300)
#   -o, --report-dir    HTML report output dir       (default: reports/local)
#   -h, --help          Show this help
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────
TEST_TYPE="load"
BASE_URL="localhost"
PORT="8080"
THREADS="50"
RAMP_UP="30"
DURATION="300"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="results/${TIMESTAMP}"
REPORT_DIR="reports/local/${TIMESTAMP}"
JMETER_HOME="${JMETER_HOME:-/opt/jmeter}"
TEST_PLAN="test-plans/performance-test-plan.jmx"

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()   { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Argument Parsing ──────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--test-type)   TEST_TYPE="$2";   shift 2 ;;
        -u|--base-url)    BASE_URL="$2";    shift 2 ;;
        -p|--port)        PORT="$2";        shift 2 ;;
        -n|--threads)     THREADS="$2";     shift 2 ;;
        -r|--ramp-up)     RAMP_UP="$2";     shift 2 ;;
        -d|--duration)    DURATION="$2";    shift 2 ;;
        -o|--report-dir)  REPORT_DIR="$2";  shift 2 ;;
        -h|--help)
            sed -n '2,20p' "$0" | grep '^#' | sed 's/^# \{0,2\}//'
            exit 0 ;;
        *) error "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Pre-flight checks ─────────────────────────────────────────
if [ ! -f "${JMETER_HOME}/bin/jmeter" ]; then
    error "JMeter not found at ${JMETER_HOME}. Set JMETER_HOME or install JMeter."
    exit 1
fi

if [ ! -f "${TEST_PLAN}" ]; then
    error "Test plan not found: ${TEST_PLAN}"
    exit 1
fi

# ── Create output dirs ────────────────────────────────────────
mkdir -p "${RESULTS_DIR}" "${REPORT_DIR}"

log "Starting ${TEST_TYPE} test"
log "  Target     : ${BASE_URL}:${PORT}"
log "  Users      : ${THREADS}"
log "  Ramp-up    : ${RAMP_UP}s"
log "  Duration   : ${DURATION}s"
log "  Results    : ${RESULTS_DIR}"
log "  Report     : ${REPORT_DIR}"
echo ""

# ── Run JMeter ────────────────────────────────────────────────
"${JMETER_HOME}/bin/jmeter" \
    -n \
    -t "${TEST_PLAN}" \
    -l "${RESULTS_DIR}/results.jtl" \
    -e -o "${REPORT_DIR}" \
    -Jbase_url="${BASE_URL}" \
    -Jport="${PORT}" \
    -Jthreads="${THREADS}" \
    -Jramp_up="${RAMP_UP}" \
    -Jduration="${DURATION}" \
    -Jjmeter.save.saveservice.output_format=csv \
    -Jjmeter.save.saveservice.response_code=true \
    -Jjmeter.save.saveservice.latency=true \
    -Jjmeter.save.saveservice.connect_time=true \
    -Jjmeter.save.saveservice.timestamp_format=ms \
    --loglevel WARN \
    2>&1 | tee "${RESULTS_DIR}/jmeter.log"

JMX_EXIT=${PIPESTATUS[0]}

# ── Parse and validate results ────────────────────────────────
echo ""
log "Parsing results..."
python3 scripts/parse_results.py \
    "${RESULTS_DIR}/results.jtl" \
    --output "${RESULTS_DIR}/metrics.json" \
    --format json

log "Validating thresholds..."
ERROR_RATE=$(python3 -c "import json; print(json.load(open('${RESULTS_DIR}/metrics.json'))['error_rate'])")
AVG_RT=$(python3 -c "import json; print(json.load(open('${RESULTS_DIR}/metrics.json'))['avg_response_time'])")
P95_RT=$(python3 -c "import json; print(json.load(open('${RESULTS_DIR}/metrics.json'))['p95_response_time'])")
THROUGHPUT=$(python3 -c "import json; print(json.load(open('${RESULTS_DIR}/metrics.json'))['throughput'])")

python3 scripts/validate_thresholds.py \
    --error-rate "${ERROR_RATE}" \
    --avg-rt "${AVG_RT}" \
    --p95-rt "${P95_RT}" \
    --throughput "${THROUGHPUT}" \
    --max-error-rate 2.0 \
    --max-avg-rt 2000 \
    --max-p95-rt 5000

THRESHOLD_EXIT=$?

# ── Print report location ─────────────────────────────────────
echo ""
log "HTML report: ${REPORT_DIR}/index.html"
log "JTL results: ${RESULTS_DIR}/results.jtl"
log "Metrics JSON: ${RESULTS_DIR}/metrics.json"

# Open report in browser (macOS)
if command -v open &>/dev/null; then
    open "${REPORT_DIR}/index.html"
fi

exit $((JMX_EXIT + THRESHOLD_EXIT))
