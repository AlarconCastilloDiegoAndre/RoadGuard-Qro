"""
RoadGuard Qro — Pavement Damage Severity Scoring Module.

Computes a deterministic, explainable severity score (0.0 to 1.0) and discrete level
('low', 'medium', 'high', 'critical') for every detected pavement anomaly.

Formulation:
    S = w_class * class_weight + w_area * (bbox_area / frame_area) * f(y_center)

Where:
    - class_weight: intrinsic hazard of damage type (pothole > alligator > transverse > longitudinal).
    - bbox_area / frame_area: fraction of surface covered by the bounding box.
    - f(y_center): perspective correction factor. In forward-facing vehicle cameras, damages closer
      to the horizon (smaller y in normalized coords where y=0 is top) are physically larger in the
      real world per pixel than damages near the hood of the vehicle (larger y).
"""

from typing import Dict, Literal, Tuple

SeverityLevel = Literal["low", "medium", "high", "critical"]

# Intrinsic hazard weight by damage class
CLASS_WEIGHTS: Dict[str, float] = {
    "D00": 0.40,  # Longitudinal crack
    "D10": 0.50,  # Transverse crack
    "D20": 0.80,  # Alligator / fatigue cracking (structural road base failure)
    "D40": 1.00,  # Pothole (immediate vehicle safety hazard)
}

CLASS_NAME_MAP: Dict[int, str] = {
    0: "D00",
    1: "D10",
    2: "D20",
    3: "D40",
}


def perspective_factor(y_center: float) -> float:
    """
    Computes road perspective correction factor.

    In dashboard cameras, the top of the roadway ROI is farther away from the camera.
    A 50x50px box near the horizon represents a much larger physical defect than a 50x50px
    box near the bottom bumper.

    Args:
        y_center: Normalized vertical coordinate [0.0 (top of ROI) to 1.0 (bottom of ROI)].

    Returns:
        Scaling multiplier between 1.0 and 2.5.
    """
    # Clamping y_center to valid range
    y = max(0.0, min(1.0, float(y_center)))
    # Linear perspective scaling: horizon (y=0.0) -> 2.5x, close bumper (y=1.0) -> 1.0x
    return 2.5 - (1.5 * y)


def compute_severity(
    class_name_or_id: str | int,
    bbox_width: float,
    bbox_height: float,
    y_center: float = 0.5,
    w_class: float = 0.65,
    w_area: float = 0.35,
) -> Tuple[float, SeverityLevel]:
    """
    Calculates numerical severity score and categorical rating.

    Args:
        class_name_or_id: Class name ('D00', 'D10', 'D20', 'D40') or integer id [0..3].
        bbox_width: Normalized bounding box width [0.0..1.0].
        bbox_height: Normalized bounding box height [0.0..1.0].
        y_center: Normalized box vertical center [0.0..1.0].
        w_class: Weight assigned to damage type hazard (default 0.65).
        w_area: Weight assigned to physical dimensions & perspective (default 0.35).

    Returns:
        Tuple of (score: float in [0.0, 1.0], level: SeverityLevel).
    """
    if isinstance(class_name_or_id, int):
        class_code = CLASS_NAME_MAP.get(class_name_or_id, "D00")
    else:
        class_code = str(class_name_or_id).upper()

    base_class_weight = CLASS_WEIGHTS.get(class_code, 0.40)

    # Relative area [0.0..1.0]
    norm_area = max(0.0, min(1.0, float(bbox_width) * float(bbox_height)))

    # Apply perspective correction (scaled and clamped)
    persp = perspective_factor(y_center)
    # Area contribution: normalized so a 20% frame coverage at distance saturates to 1.0
    area_contrib = min(1.0, norm_area * persp * 5.0)

    # Combined composite score
    score = (w_class * base_class_weight) + (w_area * area_contrib)
    score = round(max(0.0, min(1.0, score)), 4)

    # Categorical severity thresholds
    if score >= 0.75:
        level: SeverityLevel = "critical"
    elif score >= 0.55:
        level = "high"
    elif score >= 0.35:
        level = "medium"
    else:
        level = "low"

    return score, level


if __name__ == "__main__":
    # Test cases
    cases = [
        ("D40", 0.15, 0.12, 0.3, "Large pothole in distance"),
        ("D40", 0.05, 0.04, 0.8, "Small pothole near vehicle"),
        ("D20", 0.20, 0.15, 0.5, "Moderate alligator cracking"),
        ("D00", 0.02, 0.25, 0.6, "Longitudinal hair crack"),
    ]
    print(f"{'Class':<6} {'Score':<8} {'Level':<10} Description")
    print("-" * 50)
    for c, w, h, y, desc in cases:
        sc, lvl = compute_severity(c, w, h, y)
        print(f"{c:<6} {sc:<8.4f} {lvl:<10} {desc}")
