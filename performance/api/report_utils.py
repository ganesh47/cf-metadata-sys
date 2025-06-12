import html
from typing import Dict, Any


def generate_html_report(metrics: Dict[str, Any], percentiles: Dict[str, Any]) -> str:
    """Return a simple HTML representation of the latency report."""
    total_requests = metrics.get("success_count", 0) + metrics.get("failure_count", 0)
    html_parts = [
        "<html><head><meta charset='utf-8'><title>Load Test Report</title></head><body>",
        "<h1>Detailed Latency Metrics</h1>",
        "<h2>Test Summary</h2>",
        "<ul>"
    ]
    html_parts.append(f"<li>Start time: {metrics.get('test_start_time')}</li>")
    html_parts.append(f"<li>End time: {metrics.get('test_end_time')}</li>")
    html_parts.append(f"<li>Duration: {metrics.get('test_duration_seconds', 0):.2f} seconds</li>")
    html_parts.append(f"<li>Total requests: {total_requests}</li>")
    success_rate = (metrics.get('success_count', 0) / total_requests * 100) if total_requests else 0
    html_parts.append(f"<li>Success rate: {metrics.get('success_count', 0)}/{total_requests} ({success_rate:.2f}%)</li>")
    if metrics.get('test_duration_seconds', 0) > 0:
        rps = total_requests / metrics['test_duration_seconds']
        html_parts.append(f"<li>Requests per second: {rps:.2f}</li>")
    html_parts.append("</ul>")

    # Phase timing
    html_parts.append("<h2>Phase Timing</h2><ul>")
    for phase, duration in metrics.get('operation_phase_times', {}).items():
        html_parts.append(f"<li>{phase.replace('_',' ').title()}: {duration:.2f}ms</li>")
    html_parts.append("</ul>")

    # Latency distribution
    html_parts.append("<h2>Latency Distribution</h2>")
    html_parts.append("<table><thead><tr><th>Range</th><th>Count</th><th>Percentage</th></tr></thead><tbody>")
    total_latency = sum(metrics.get('latency_distribution', {}).values())
    for rng, count in metrics.get('latency_distribution', {}).items():
        pct = (count / total_latency * 100) if total_latency else 0
        html_parts.append(f"<tr><td>{rng}</td><td>{count}</td><td>{pct:.2f}%</td></tr>")
    html_parts.append("</tbody></table>")

    # Overall percentiles
    if 'overall' in percentiles:
        html_parts.append("<h2>Overall Latency Percentiles</h2><ul>")
        html_parts.append(f"<li>Median (P50): {percentiles['overall']['median']:.2f}ms</li>")
        html_parts.append(f"<li>P90: {percentiles['overall']['p90']:.2f}ms</li>")
        html_parts.append(f"<li>P95: {percentiles['overall']['p95']:.2f}ms</li>")
        html_parts.append(f"<li>P99: {percentiles['overall']['p99']:.2f}ms</li>")
        html_parts.append("</ul>")

    # Endpoint metrics - top 5 slowest
    endpoint_avg_times = []
    for key, data in metrics.get('endpoints', {}).items():
        if data.get('count', 0) > 0:
            avg = data['total_time'] / data['count']
            endpoint_avg_times.append((key, avg, data))
    endpoint_avg_times.sort(key=lambda x: x[1], reverse=True)
    top = endpoint_avg_times[:5]

    if top:
        html_parts.append("<h2>Endpoint Performance (Top 5 slowest)</h2>")
        html_parts.append("<table><thead><tr><th>Endpoint</th><th>Count</th><th>Avg</th><th>Min</th><th>Max</th></tr></thead><tbody>")
        for key, avg, data in top:
            html_parts.append(
                f"<tr><td>{html.escape(key)}</td><td>{data['count']}</td><td>{avg:.2f}ms</td><td>{data['min']:.2f}ms</td><td>{data['max']:.2f}ms</td></tr>"
            )
        html_parts.append("</tbody></table>")

    # Status code distribution
    html_parts.append("<h2>Status Codes</h2>")
    html_parts.append("<table><thead><tr><th>Status</th><th>Count</th><th>Percentage</th></tr></thead><tbody>")
    for code, count in sorted(metrics.get('status_codes', {}).items()):
        pct = (count / total_requests * 100) if total_requests else 0
        html_parts.append(f"<tr><td>{code}</td><td>{count}</td><td>{pct:.2f}%</td></tr>")
    html_parts.append("</tbody></table>")

    # Errors if any
    if metrics.get('errors'):
        html_parts.append("<h2>Errors (first 10)</h2><ul>")
        for err in metrics['errors'][:10]:
            html_parts.append(f"<li>{html.escape(err)}</li>")
        if len(metrics['errors']) > 10:
            html_parts.append(f"<li>... and {len(metrics['errors'])-10} more errors</li>")
        html_parts.append("</ul>")

    html_parts.append("</body></html>")
    return "\n".join(html_parts)
