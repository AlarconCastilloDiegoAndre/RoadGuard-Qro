"""
Pavement Damage Severity Scoring Module (Production Backend).
Synchronized with ml/scripts/severity.py.
"""

from typing import Dict, Literal, Tuple

SeverityLevel = Literal["low", "medium", "high", "critical"]

CLASS_WEIGHTS: Dict[str, float] = {
    "D00": 0.40,  # Longitudinal crack
    "D10": 0.50,  # Transverse crack
    "D20": 0.80,  # Alligator / fatigue cracking
    "D40": 1.00,  # Pothole
}

CLASS_NAME_MAP: Dict[int, str] = {
    0: "D00",
    1: "D10",
    2: "D20",
    3: "D40",
}


def perspective_factor(y_center: float) -> float:
    y = max(0.0, min(1.0, float(y_center)))
    return 2.5 - (1.5 * y)


def compute_severity(
    class_name_or_id: str | int,
    bbox_width: float,
    bbox_height: float,
    y_center: float = 0.5,
    w_class: float = 0.65,
    w_area: float = 0.35,
) -> Tuple[float, SeverityLevel]:
    if isinstance(class_name_or_id, int):
        class_code = CLASS_NAME_MAP.get(class_name_or_id, "D00")
    else:
        class_code = str(class_name_or_id).upper()

    base_class_weight = CLASS_WEIGHTS.get(class_code, 0.40)
    norm_area = max(0.0, min(1.0, float(bbox_width) * float(bbox_height)))
    persp = perspective_factor(y_center)
    area_contrib = min(1.0, norm_area * persp * 5.0)

    score = (w_class * base_class_weight) + (w_area * area_contrib)
    score = round(max(0.0, min(1.0, score)), 4)

    if score >= 0.75:
        level: SeverityLevel = "critical"
    elif score >= 0.55:
        level = "high"
    elif score >= 0.35:
        level = "medium"
    else:
        level = "low"

    return score, level
