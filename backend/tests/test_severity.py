from backend.app.severity import compute_severity, perspective_factor


def test_perspective_factor():
    # Near horizon (y=0.0) -> high amplification factor 2.5
    assert perspective_factor(0.0) == 2.5
    # Near bumper (y=1.0) -> factor 1.0
    assert perspective_factor(1.0) == 1.0
    # Clamping
    assert perspective_factor(-0.5) == 2.5
    assert perspective_factor(1.5) == 1.0


def test_compute_severity_pothole():
    # Pothole (D40) with significant size at horizon
    score, level = compute_severity("D40", bbox_width=0.2, bbox_height=0.2, y_center=0.1)
    assert 0.0 <= score <= 1.0
    assert level in ["high", "critical"]


def test_compute_severity_hair_crack():
    # Longitudinal crack (D00) tiny hairline near bumper
    score, level = compute_severity("D00", bbox_width=0.01, bbox_height=0.05, y_center=0.9)
    assert score < 0.40
    assert level == "low"
